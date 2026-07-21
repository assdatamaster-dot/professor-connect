import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EventType, type SocketMessage } from '@professor-connect/protocol';

import { CommandDispatcher } from '../src/client/core/remote-control/command.dispatcher.js';
import { PermissionManager } from '../src/client/core/remote-control/permission.manager.js';
import { RemoteControlManager } from '../src/client/core/remote-control/remote-control.manager.js';
import { RemoteControlService } from '../src/client/core/remote-control/remote-control.service.js';
import {
  RemoteCommandType,
  RemoteControlState,
  RemoteMouseButton,
  type PermissionScheduler,
  type PermissionTimerHandle,
  type RemoteCommand,
  type RemoteCommandExecutorPort,
  type RemoteControlServicePort,
  type RemoteControlSignalingPort,
} from '../src/client/core/remote-control/remote.types.js';
import {
  DEFAULT_DATA_CHANNEL_LABEL,
  DataChannelService,
} from '../src/modules/webrtc/data-channel.service.js';
import type {
  DataChannelCloseHandler,
  DataChannelErrorHandler,
  DataChannelMessageHandler,
  DataChannelOpenHandler,
  DataChannelPort,
  DataChannelReadyState,
} from '../src/modules/webrtc/peer.types.js';
import type { WebRtcLogger } from '../src/modules/webrtc/webrtc.types.js';

const CALL_ID = 'call-remote-control';
const SESSION_ID = 'session-remote-control';
const AUTHORIZATION_DURATION_MS = 30_000;

interface ServiceHolder {
  service?: RemoteControlServicePort;
}

interface RemoteFixture {
  readonly professor: RemoteControlService;
  readonly student: RemoteControlService;
  readonly professorPermission: PermissionManager;
  readonly studentPermission: PermissionManager;
  readonly executedCommands: RemoteCommand[];
  readonly authorizationMessages: SocketMessage<unknown>[];
  readonly peerMessages: string[];
  readonly logs: string[];
  readonly errors: unknown[];
}

test('autoriza canal, transporta todos os comandos via DataChannel e permite revogação', async () => {
  const fixture = createFixture();

  await fixture.professor.request(CALL_ID, SESSION_ID, AUTHORIZATION_DURATION_MS);
  assert.equal(fixture.professor.getState(), RemoteControlState.REQUESTED);
  assert.equal(fixture.student.getState(), RemoteControlState.REQUESTED);

  await fixture.student.accept();
  assert.equal(fixture.professor.getState(), RemoteControlState.ACTIVE);
  assert.equal(fixture.student.getState(), RemoteControlState.ACTIVE);

  const commands = createCommands();

  for (const command of commands) {
    const message = fixture.professor.sendCommand(command);

    assert.equal(message.event, EventType.REMOTE_COMMAND);
    assert.equal(message.sessionId, SESSION_ID);
  }
  await waitUntil(() => fixture.executedCommands.length === commands.length);

  assert.deepEqual(fixture.executedCommands, commands);
  assert.equal(fixture.peerMessages.length, commands.length);
  assert(
    fixture.peerMessages.every(
      (data) =>
        (JSON.parse(data) as Readonly<{ event: string }>).event === EventType.REMOTE_COMMAND,
    ),
  );
  assert.deepEqual(
    fixture.authorizationMessages.map((message) => message.event),
    [EventType.REMOTE_REQUEST, EventType.REMOTE_ACCEPT, EventType.REMOTE_STARTED],
  );
  assert(fixture.authorizationMessages.every(hasValidEnvelope));
  assert(
    !fixture.authorizationMessages.some((message) => message.event === EventType.REMOTE_COMMAND),
  );

  await fixture.student.revoke();
  assert.equal(fixture.professor.getState(), RemoteControlState.STOPPED);
  assert.equal(fixture.student.getState(), RemoteControlState.STOPPED);
  assert.equal(fixture.authorizationMessages.at(-1)?.event, EventType.REMOTE_STOPPED);
  assert.throws(() => fixture.professor.sendCommand(commands[0] as RemoteCommand));
  assert(fixture.logs.includes('Solicitação enviada'));
  assert(fixture.logs.includes('Solicitação aceita'));
  assert(fixture.logs.includes('Sessão iniciada'));
  assert(fixture.logs.includes('Comando enviado'));
  assert(fixture.logs.includes('Comando recebido'));
  assert(fixture.logs.includes('Sessão encerrada'));
  assert.equal(fixture.errors.length, 0);
});

test('aluno pode negar autorização sem ativar o DataChannel de controle', async () => {
  const fixture = createFixture();

  await fixture.professor.request(CALL_ID, SESSION_ID, AUTHORIZATION_DURATION_MS);
  await fixture.student.deny();

  assert.equal(fixture.professor.getState(), RemoteControlState.DENIED);
  assert.equal(fixture.student.getState(), RemoteControlState.DENIED);
  assert.deepEqual(
    fixture.authorizationMessages.map((message) => message.event),
    [EventType.REMOTE_REQUEST, EventType.REMOTE_DENY],
  );
  assert.throws(() => fixture.professor.sendCommand(createCommands()[0] as RemoteCommand));
});

test('Permission Manager expira a autorização pela State Machine', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');
  const scheduler = new TestScheduler();
  const manager = new PermissionManager({ clock: () => now, scheduler });
  let expired = false;

  manager.onExpired(() => {
    expired = true;
  });
  manager.request({
    callId: CALL_ID,
    sessionId: SESSION_ID,
    authorizationId: 'authorization-expiring',
    durationMs: 1_000,
  });
  manager.authorize('2026-07-20T12:00:01.000Z');
  manager.activate();
  scheduler.run();

  assert.equal(manager.getState(), RemoteControlState.EXPIRED);
  assert.equal(manager.isAuthorized(), false);
  assert.equal(expired, true);
  assert.deepEqual(
    manager.getStateHistory().map((transition) => transition.nextState),
    [
      RemoteControlState.REQUESTED,
      RemoteControlState.AUTHORIZED,
      RemoteControlState.ACTIVE,
      RemoteControlState.EXPIRED,
    ],
  );
});

function createFixture(): RemoteFixture {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const authorizationMessages: SocketMessage<unknown>[] = [];
  const peerMessages: string[] = [];
  const executedCommands: RemoteCommand[] = [];
  const logger = createLogger(logs, errors);
  const professorChannel = new TestDataChannel(peerMessages);
  const studentChannel = new TestDataChannel();

  professorChannel.connect(studentChannel);
  studentChannel.connect(professorChannel);

  const professorDataChannel = new DataChannelService(logger);
  const studentDataChannel = new DataChannelService(logger);

  professorDataChannel.attach(CALL_ID, SESSION_ID, professorChannel);
  studentDataChannel.attach(CALL_ID, SESSION_ID, studentChannel);

  const professorHolder: ServiceHolder = {};
  const studentHolder: ServiceHolder = {};
  const professorPermission = new PermissionManager({ logger });
  const studentPermission = new PermissionManager({ logger });
  const professorManager = new RemoteControlManager(
    professorPermission,
    new CommandDispatcher(undefined, logger),
    professorDataChannel,
    logger,
  );
  const studentManager = new RemoteControlManager(
    studentPermission,
    new CommandDispatcher(new RecordingExecutor(executedCommands), logger),
    studentDataChannel,
    logger,
  );
  const professor = new RemoteControlService(
    professorPermission,
    professorManager,
    createAuthorizationRelay(studentHolder, authorizationMessages),
    { logger },
  );
  const student = new RemoteControlService(
    studentPermission,
    studentManager,
    createAuthorizationRelay(professorHolder, authorizationMessages),
    { logger },
  );

  professorHolder.service = professor;
  studentHolder.service = student;
  return {
    professor,
    student,
    professorPermission,
    studentPermission,
    executedCommands,
    authorizationMessages,
    peerMessages,
    logs,
    errors,
  };
}

function createAuthorizationRelay(
  remoteHolder: ServiceHolder,
  messages: SocketMessage<unknown>[],
): RemoteControlSignalingPort {
  const remote = (): RemoteControlServicePort => {
    assert(remoteHolder.service !== undefined);
    return remoteHolder.service;
  };

  return {
    sendRequest(message): void {
      messages.push(message);
      remote().receiveRequest(message);
    },
    async sendAccept(message): Promise<void> {
      messages.push(message);
      await remote().receiveAccept(message);
    },
    sendDeny(message): void {
      messages.push(message);
      remote().receiveDeny(message);
    },
    sendStarted(message): void {
      messages.push(message);
      remote().receiveStarted(message);
    },
    sendStopped(message): void {
      messages.push(message);
      remote().receiveStopped(message);
    },
    sendExpired(message): void {
      messages.push(message);
      remote().receiveExpired(message);
    },
    sendFailed(message): void {
      messages.push(message);
      remote().receiveFailed(message);
    },
  };
}

function createCommands(): RemoteCommand[] {
  const timestamp = new Date().toISOString();

  return [
    {
      commandId: 'command-move',
      type: RemoteCommandType.MOUSE_MOVE,
      timestamp,
      payload: { x: 120, y: 240 },
    },
    {
      commandId: 'command-down',
      type: RemoteCommandType.MOUSE_DOWN,
      timestamp,
      payload: { button: RemoteMouseButton.LEFT },
    },
    {
      commandId: 'command-up',
      type: RemoteCommandType.MOUSE_UP,
      timestamp,
      payload: { button: RemoteMouseButton.LEFT },
    },
    {
      commandId: 'command-wheel',
      type: RemoteCommandType.MOUSE_WHEEL,
      timestamp,
      payload: { deltaX: 0, deltaY: -120 },
    },
    {
      commandId: 'command-key-down',
      type: RemoteCommandType.KEY_DOWN,
      timestamp,
      payload: { code: 'KeyA', key: 'a', repeat: false },
    },
    {
      commandId: 'command-key-up',
      type: RemoteCommandType.KEY_UP,
      timestamp,
      payload: { code: 'KeyA', key: 'a', repeat: false },
    },
  ];
}

class RecordingExecutor implements RemoteCommandExecutorPort {
  public constructor(private readonly commands: RemoteCommand[]) {}

  public execute(command: RemoteCommand): void {
    this.commands.push(command);
  }
}

class TestDataChannel implements DataChannelPort {
  public readonly label = DEFAULT_DATA_CHANNEL_LABEL;
  public readyState: DataChannelReadyState = 'open';
  private peer: TestDataChannel | undefined;
  private closeHandler: DataChannelCloseHandler = () => undefined;
  private messageHandler: DataChannelMessageHandler = () => undefined;

  public constructor(private readonly sentMessages: string[] = []) {}

  public connect(peer: TestDataChannel): void {
    this.peer = peer;
  }

  public send(data: string): void {
    this.sentMessages.push(data);
    this.peer?.messageHandler(data);
  }

  public close(): void {
    this.readyState = 'closed';
    this.closeHandler();
  }

  public setOpenHandler(handler: DataChannelOpenHandler): void {
    void handler;
  }

  public setCloseHandler(handler: DataChannelCloseHandler): void {
    this.closeHandler = handler;
  }

  public setErrorHandler(handler: DataChannelErrorHandler): void {
    void handler;
  }

  public setMessageHandler(handler: DataChannelMessageHandler): void {
    this.messageHandler = handler;
  }
}

class TestScheduler implements PermissionScheduler {
  private action: (() => void) | undefined;

  public schedule(action: () => void, delayMs: number): PermissionTimerHandle {
    void delayMs;
    this.action = action;
    return setTimeout(() => undefined, 60_000);
  }

  public cancel(handle: PermissionTimerHandle): void {
    clearTimeout(handle);
    this.action = undefined;
  }

  public run(): void {
    const action = this.action;

    this.action = undefined;
    action?.();
  }
}

function createLogger(messages: string[], errors: unknown[]): WebRtcLogger {
  return {
    info(message): void {
      messages.push(message);
    },
    error(_message, error): void {
      errors.push(error);
    },
  };
}

function hasValidEnvelope(message: SocketMessage<unknown>): boolean {
  return (
    message.id.trim().length > 0 &&
    Object.values(EventType).includes(message.event) &&
    !Number.isNaN(Date.parse(message.timestamp)) &&
    message.sessionId === SESSION_ID
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error('Tempo limite excedido');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
