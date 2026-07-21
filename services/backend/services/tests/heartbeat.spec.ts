import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CallStatus,
  ClientRole,
  ConnectionState,
  ConnectionStatus,
  EventType,
  PresenceStatus,
  RequestStatus,
  SessionStatus,
  type Call,
  type ClientPresence,
  type ServiceRequest,
  type Session,
} from '@professor-connect/protocol';

import {
  HeartbeatManager,
  HeartbeatService,
  type ConnectionRecoveryResources,
  type HeartbeatConnectionPort,
  type HeartbeatLifecycleEvent,
  type HeartbeatLogger,
  type HeartbeatPresencePort,
  type HeartbeatSettings,
} from '../src/index.js';

const CLIENT_ID = 'student-1';
const OLD_CONNECTION_ID = 'socket-old';
const NEW_CONNECTION_ID = 'socket-new';
const INITIAL_TIME = Date.parse('2026-07-20T12:00:00.000Z');
const SETTINGS: HeartbeatSettings = {
  intervalMs: 30,
  timeoutMs: 90,
  reconnectWindowMs: 60,
};

test('monitora cliente conectado e registra heartbeat normal', () => {
  const fixture = createFixture();

  fixture.service.registerClient(CLIENT_ID, OLD_CONNECTION_ID);
  fixture.clock.advance(SETTINGS.intervalMs);
  fixture.service.runCycle();

  assert.deepEqual(fixture.connectionPort.inactiveConnections, [OLD_CONNECTION_ID]);
  assert.deepEqual(
    fixture.events.map((event) => event.event),
    [EventType.HEARTBEAT_PING],
  );

  const client = fixture.service.recordHeartbeat(OLD_CONNECTION_ID);

  assert.equal(client.status, ConnectionStatus.ACTIVE);
  assert.equal(client.connectionState, ConnectionState.CONNECTED);
  assert.equal(client.lastSeen, fixture.clock.now().toISOString());
  assert.deepEqual(fixture.connectionPort.receivedHeartbeats, [OLD_CONNECTION_ID]);
  assert(fixture.logs.includes('Heartbeat enviado'));
  assert(fixture.logs.includes('Heartbeat recebido'));
});

test('restaura presença, Session, Request e Call sem duplicar o cliente', () => {
  const fixture = createFixture();

  fixture.service.registerClient(CLIENT_ID, OLD_CONNECTION_ID);
  const lostClient = fixture.service.markConnectionLost(OLD_CONNECTION_ID);
  fixture.clock.advance(SETTINGS.reconnectWindowMs - 1);
  const recovery = fixture.service.recoverClient(CLIENT_ID, NEW_CONNECTION_ID);

  assert.equal(lostClient?.connectionState, ConnectionState.LOST);
  assert(recovery !== undefined);
  assert.equal(recovery.clientId, CLIENT_ID);
  assert.equal(recovery.connectionId, NEW_CONNECTION_ID);
  assert.equal(recovery.previousConnectionId, OLD_CONNECTION_ID);
  assert.equal(recovery.presence.status, PresenceStatus.AVAILABLE);
  assert.deepEqual(recovery.sessions, [fixture.session]);
  assert.deepEqual(recovery.requests, [fixture.request]);
  assert.deepEqual(recovery.calls, [fixture.call]);
  assert.equal(fixture.service.listClients().length, 1);
  assert.deepEqual(fixture.connectionPort.recoveredConnections, [
    [OLD_CONNECTION_ID, NEW_CONNECTION_ID],
  ]);
  assert.deepEqual(fixture.resources.replacedConnections, [[OLD_CONNECTION_ID, NEW_CONNECTION_ID]]);
  assert.deepEqual(
    fixture.events.map((event) => event.event),
    [EventType.CONNECTION_LOST, EventType.CONNECTION_RECOVERED],
  );
  assert(fixture.logs.includes('Cliente inativo'));
  assert(fixture.logs.includes('Reconexão'));
  assert(fixture.logs.includes('Recuperação concluída'));
});

test('encerra e remove cliente quando o heartbeat ultrapassa o timeout', () => {
  const fixture = createFixture();

  fixture.service.registerClient(CLIENT_ID, OLD_CONNECTION_ID);
  fixture.clock.advance(SETTINGS.timeoutMs);
  fixture.service.runCycle();

  assert.equal(fixture.service.findClient(CLIENT_ID), undefined);
  assert.deepEqual(fixture.connectionPort.timedOutConnections, [OLD_CONNECTION_ID]);
  assert.deepEqual(fixture.presencePort.timedOutClients, [CLIENT_ID]);
  assert.deepEqual(fixture.resources.releasedConnections, [OLD_CONNECTION_ID]);
  assert.deepEqual(
    fixture.events.map((event) => event.event),
    [EventType.CONNECTION_TIMEOUT],
  );
  assert(fixture.logs.includes('Timeout'));
});

test('não recupera estado após a janela e permite um novo registro limpo', () => {
  const fixture = createFixture();

  fixture.service.registerClient(CLIENT_ID, OLD_CONNECTION_ID);
  fixture.service.markConnectionLost(OLD_CONNECTION_ID);
  fixture.clock.advance(SETTINGS.reconnectWindowMs);

  const recovery = fixture.service.recoverClient(CLIENT_ID, NEW_CONNECTION_ID);

  assert.equal(recovery, undefined);
  assert.equal(fixture.service.findClient(CLIENT_ID), undefined);
  assert.deepEqual(fixture.connectionPort.timedOutConnections, [OLD_CONNECTION_ID]);
  assert(!fixture.events.some((event) => event.event === EventType.CONNECTION_RECOVERED));

  const newClient = fixture.service.registerClient(CLIENT_ID, NEW_CONNECTION_ID);

  assert.equal(newClient.connectionState, ConnectionState.CONNECTED);
  assert.equal(newClient.connectionId, NEW_CONNECTION_ID);
  assert.equal(fixture.service.listClients().length, 1);
});

class MutableClock {
  public constructor(private timestamp = INITIAL_TIME) {}

  public now(): Date {
    return new Date(this.timestamp);
  }

  public advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}

class RecordingConnectionPort implements HeartbeatConnectionPort {
  public readonly inactiveConnections: string[] = [];
  public readonly lostConnections: string[] = [];
  public readonly receivedHeartbeats: string[] = [];
  public readonly recoveredConnections: Array<readonly [string, string]> = [];
  public readonly timedOutConnections: string[] = [];

  public recordHeartbeat(connectionId: string): void {
    this.receivedHeartbeats.push(connectionId);
  }

  public markInactive(connectionId: string): void {
    this.inactiveConnections.push(connectionId);
  }

  public markLost(connectionId: string): void {
    this.lostConnections.push(connectionId);
  }

  public recoverConnection(previousConnectionId: string, connectionId: string): void {
    this.recoveredConnections.push([previousConnectionId, connectionId]);
  }

  public timeoutConnection(connectionId: string): void {
    this.timedOutConnections.push(connectionId);
  }
}

class RecordingPresencePort implements HeartbeatPresencePort {
  public readonly timedOutClients: string[] = [];
  private presence: ClientPresence;

  public constructor(private readonly clock: MutableClock) {
    this.presence = createPresence(OLD_CONNECTION_ID, PresenceStatus.AVAILABLE, clock.now());
  }

  public updateLastSeenByConnection(connectionId: string): ClientPresence | undefined {
    if (this.presence.connectionId !== connectionId) {
      return undefined;
    }

    this.presence = { ...this.presence, lastSeen: this.clock.now().toISOString() };
    return this.presence;
  }

  public markConnectionLost(connectionId: string): ClientPresence | undefined {
    return this.presence.connectionId === connectionId ? this.presence : undefined;
  }

  public recoverClient(clientId: string, connectionId: string): ClientPresence {
    assert.equal(clientId, CLIENT_ID);
    this.presence = {
      ...this.presence,
      connectionId,
      lastSeen: this.clock.now().toISOString(),
    };
    return this.presence;
  }

  public timeoutClient(clientId: string): ClientPresence {
    this.timedOutClients.push(clientId);
    this.presence = {
      ...this.presence,
      status: PresenceStatus.OFFLINE,
      lastSeen: this.clock.now().toISOString(),
    };
    return this.presence;
  }
}

class RecordingResources implements ConnectionRecoveryResources {
  public readonly releasedConnections: string[] = [];
  public readonly replacedConnections: Array<readonly [string, string]> = [];

  public constructor(
    private readonly session: Session,
    private readonly request: ServiceRequest,
    private readonly call: Call,
  ) {}

  public replaceSessionConnection(
    previousConnectionId: string,
    connectionId: string,
  ): readonly Session[] {
    this.replacedConnections.push([previousConnectionId, connectionId]);
    return [this.session];
  }

  public releaseSessions(connectionId: string): readonly Session[] {
    this.releasedConnections.push(connectionId);
    return [this.session];
  }

  public listPendingRequests(clientId: string): readonly ServiceRequest[] {
    return clientId === CLIENT_ID ? [this.request] : [];
  }

  public listActiveCalls(clientId: string): readonly Call[] {
    return clientId === CLIENT_ID ? [this.call] : [];
  }
}

function createFixture(): {
  readonly call: Call;
  readonly clock: MutableClock;
  readonly connectionPort: RecordingConnectionPort;
  readonly events: HeartbeatLifecycleEvent[];
  readonly logs: string[];
  readonly presencePort: RecordingPresencePort;
  readonly request: ServiceRequest;
  readonly resources: RecordingResources;
  readonly service: HeartbeatService;
  readonly session: Session;
} {
  const clock = new MutableClock();
  const connectionPort = new RecordingConnectionPort();
  const presencePort = new RecordingPresencePort(clock);
  const session = createSession(clock.now());
  const request = createRequest(clock.now());
  const call = createCall(clock.now());
  const resources = new RecordingResources(session, request, call);
  const logs: string[] = [];
  const logger: HeartbeatLogger = {
    info(message): void {
      logs.push(message);
    },
    error(_message, error): void {
      throw error;
    },
  };
  const service = new HeartbeatService(
    new HeartbeatManager(SETTINGS, () => clock.now()),
    connectionPort,
    presencePort,
    resources,
    SETTINGS,
    logger,
  );
  const events: HeartbeatLifecycleEvent[] = [];
  service.onLifecycle((event) => events.push(event));

  return {
    call,
    clock,
    connectionPort,
    events,
    logs,
    presencePort,
    request,
    resources,
    service,
    session,
  };
}

function createPresence(
  connectionId: string,
  status: PresenceStatus,
  timestamp: Date,
): ClientPresence {
  return {
    clientId: CLIENT_ID,
    connectionId,
    displayName: 'Aluno 1',
    role: ClientRole.STUDENT,
    status,
    lastSeen: timestamp.toISOString(),
  };
}

function createSession(timestamp: Date): Session {
  return {
    id: 'session-1',
    clientIds: [OLD_CONNECTION_ID],
    status: SessionStatus.WAITING,
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
  };
}

function createRequest(timestamp: Date): ServiceRequest {
  return {
    requestId: 'request-1',
    studentId: CLIENT_ID,
    status: RequestStatus.PENDING,
    createdAt: timestamp.toISOString(),
    expiresAt: new Date(timestamp.getTime() + 60_000).toISOString(),
  };
}

function createCall(timestamp: Date): Call {
  return {
    callId: 'call-1',
    requestId: 'request-accepted',
    sessionId: 'session-1',
    studentId: CLIENT_ID,
    teacherId: 'teacher-1',
    status: CallStatus.CONNECTED,
    createdAt: timestamp.toISOString(),
    connectedAt: timestamp.toISOString(),
  };
}
