import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HealthCheckService } from '../src/client/core/workflow/health-check.service.js';
import { ResourceManager } from '../src/client/core/workflow/resource.manager.js';
import { WorkflowEventType } from '../src/client/core/workflow/workflow.events.js';
import { WorkflowManager } from '../src/client/core/workflow/workflow.manager.js';
import { WorkflowService } from '../src/client/core/workflow/workflow.service.js';
import {
  WorkflowHealthStatus,
  WorkflowState,
  type WorkflowContext,
  type WorkflowEvent,
  type WorkflowLogger,
  type WorkflowStartInput,
} from '../src/client/core/workflow/workflow.types.js';
import {
  RemoteCommandType,
  type RemoteCommand,
} from '../src/client/core/remote-control/remote.types.js';

const START_INPUT: WorkflowStartInput = {
  student: {
    clientId: 'student-workflow',
    connectionId: 'student-connection',
    displayName: 'Aluno',
  },
  teacher: {
    clientId: 'teacher-workflow',
    connectionId: 'teacher-connection',
    displayName: 'Professor',
  },
};

interface WorkflowFixture {
  readonly service: WorkflowService;
  readonly manager: WorkflowManager;
  readonly runtime: TestIntegratedRuntime;
  readonly events: WorkflowEvent[];
  readonly logs: string[];
  readonly errors: unknown[];
}

test('executa o fluxo completo do MVP e libera todos os recursos', async () => {
  const fixture = createFixture();

  const requested = await fixture.service.begin(START_INPUT);

  assert.equal(fixture.service.getState(), WorkflowState.REQUESTED);
  assert.equal(requested.requestId, 'request-1');

  const active = await fixture.service.accept();

  assert.equal(fixture.service.getState(), WorkflowState.ACTIVE);
  assert.equal(active.sessionId, 'session-1');
  assert.equal(active.callId, 'call-1');
  assert.equal(fixture.service.checkHealth().status, WorkflowHealthStatus.HEALTHY);
  assert.equal(fixture.service.checkHealth().components.length, 7);

  await fixture.service.startScreenSharing();
  await fixture.service.authorizeRemoteControl();
  const command = createCommand();

  fixture.service.sendRemoteCommand(command);
  assert.deepEqual(fixture.runtime.commands, [command]);

  const report = await fixture.service.end();

  assert.equal(fixture.service.getState(), WorkflowState.COMPLETED);
  assert.equal(report.failures.length, 0);
  assert.deepEqual(report.released, [
    'screen-sharing',
    'remote-control',
    'call',
    'session',
    'peer-connection-media-streams',
    'data-channel',
    'heartbeat-timers',
    'request-timers',
    'signaling-listeners',
    'workflow-listeners',
    'memory',
  ]);
  assert.equal(fixture.runtime.hasOpenResources(), false);
  assert.deepEqual(fixture.runtime.operations.slice(0, 11), [
    'connection.connect',
    'presence.register',
    'heartbeat.start',
    'request.create',
    'request.accept',
    'session.create',
    'call.create',
    'signaling.prepare',
    'rtc.connect',
    'data-channel.connect',
    'call.connect',
  ]);
  assert(fixture.logs.includes('Início do atendimento'));
  assert(fixture.logs.includes('Fim do atendimento'));
  assert(fixture.logs.includes('Tempo da sessão'));
  assert(fixture.logs.includes('Tempo da chamada'));
  assert(fixture.logs.includes('Liberação de recursos'));
  assert(fixture.events.some((event) => event.type === WorkflowEventType.MEDIA_STARTED));
  assert(fixture.events.some((event) => event.type === WorkflowEventType.RESOURCES_RELEASED));
  assert.equal(fixture.errors.length, 0);
});

test('falha na negociação WebRTC encerra o contexto parcial sem vazamentos', async () => {
  const fixture = createFixture();

  await fixture.service.begin(START_INPUT);
  fixture.runtime.failNegotiation = true;
  await assert.rejects(fixture.service.accept(), /Falha simulada na negociação/);

  assert.equal(fixture.service.getState(), WorkflowState.FAILED);
  assert(fixture.runtime.operations.includes('call.fail'));
  assert(fixture.runtime.operations.includes('session.close'));
  assert(fixture.runtime.operations.includes('rtc.close'));
  assert(fixture.runtime.operations.includes('memory.clear'));
  assert.equal(fixture.runtime.hasOpenResources(), false);
  assert(fixture.events.some((event) => event.type === WorkflowEventType.FAILED));
  assert(fixture.errors.length >= 1);
});

test('recupera queda de conexão durante atendimento e restaura o Health Check', async () => {
  const fixture = createFixture();

  await fixture.service.begin(START_INPUT);
  await fixture.service.accept();
  fixture.runtime.dropConnection();
  assert.equal(fixture.service.checkHealth().status, WorkflowHealthStatus.UNHEALTHY);

  await fixture.service.recover();

  assert.equal(fixture.service.getState(), WorkflowState.ACTIVE);
  assert.equal(fixture.service.checkHealth().status, WorkflowHealthStatus.HEALTHY);
  assert(fixture.runtime.operations.includes('connection.recover'));
  assert(fixture.runtime.operations.includes('rtc.reconnect'));
  assert(fixture.runtime.operations.includes('data-channel.reconnect'));
  assert(fixture.logs.includes('Recuperações'));
});

test('continua liberando recursos quando uma etapa de encerramento falha', async () => {
  const fixture = createFixture();

  await fixture.service.begin(START_INPUT);
  await fixture.service.accept();
  fixture.runtime.failRtcClose = true;
  const report = await fixture.service.end();

  assert.equal(fixture.service.getState(), WorkflowState.FAILED);
  assert.deepEqual(
    report.failures.map(({ resource }) => resource),
    ['peer-connection-media-streams'],
  );
  assert(fixture.runtime.operations.includes('data-channel.close'));
  assert(fixture.runtime.operations.includes('heartbeat.stop'));
  assert(fixture.runtime.operations.includes('listeners.remove'));
  assert(fixture.runtime.operations.includes('memory.clear'));
});

test('permite múltiplos atendimentos sequenciais sem reutilizar contexto ou recursos', async () => {
  const fixture = createFixture();
  const workflowIds: string[] = [];

  for (let index = 0; index < 2; index += 1) {
    workflowIds.push((await fixture.service.begin(START_INPUT)).workflowId);
    await fixture.service.accept();
    await fixture.service.end();
    assert.equal(fixture.service.getState(), WorkflowState.COMPLETED);
    assert.equal(fixture.runtime.hasOpenResources(), false);
  }

  assert.deepEqual(workflowIds, ['workflow-1', 'workflow-2']);
  assert.equal(countOperation(fixture.runtime.operations, 'request.create'), 2);
  assert.equal(countOperation(fixture.runtime.operations, 'rtc.close'), 2);
  assert.equal(countOperation(fixture.runtime.operations, 'memory.clear'), 2);
});

function createFixture(): WorkflowFixture {
  const runtime = new TestIntegratedRuntime();
  const logs: string[] = [];
  const errors: unknown[] = [];
  const logger: WorkflowLogger = {
    info(message): void {
      logs.push(message);
    },
    error(_message, error): void {
      errors.push(error);
    },
  };
  const dependencies = runtime.dependencies;
  const healthCheck = new HealthCheckService(dependencies);
  const resources = new ResourceManager({
    ...dependencies,
    memory: { clear: (workflowId) => runtime.clear(workflowId) },
    logger,
  });

  resources.registerListener(() => runtime.removeWorkflowListeners());
  let workflowIndex = 0;
  const manager = new WorkflowManager(dependencies, resources, healthCheck, {
    logger,
    workflowIdFactory: () => `workflow-${++workflowIndex}`,
  });
  const service = new WorkflowService(manager, healthCheck);
  const events: WorkflowEvent[] = [];

  service.onEvent((event) => events.push(event));
  return { service, manager, runtime, events, logs, errors };
}

class TestIntegratedRuntime {
  public readonly operations: string[] = [];
  public readonly commands: RemoteCommand[] = [];
  public failNegotiation = false;
  public failRtcClose = false;
  private socketsConnected = false;
  private presenceReady = false;
  private heartbeatHealthy = false;
  private sessionActive = false;
  private callActive = false;
  private peerConnected = false;
  private mediaStreams = false;
  private dataChannelOpen = false;
  private screenSharingActive = false;
  private remoteControlActive = false;
  private requestIndex = 0;
  private sessionIndex = 0;
  private callIndex = 0;

  public get dependencies() {
    return {
      connection: {
        connectParticipants: (input: WorkflowStartInput) => this.connectParticipants(input),
        recoverParticipants: (context: WorkflowContext) => this.recoverParticipants(context),
        areSocketsConnected: (context: WorkflowContext) => this.areSocketsConnected(context),
      },
      presence: {
        registerParticipants: (input: WorkflowStartInput) => this.registerParticipants(input),
        isReady: (context: WorkflowContext) => this.isReady(context),
      },
      request: {
        createRequest: (context: WorkflowContext) => this.createRequest(context),
        acceptRequest: (context: WorkflowContext, requestId: string) =>
          this.acceptRequest(context, requestId),
        cancelTimers: () => this.cancelTimers(),
      },
      session: {
        createSession: (context: WorkflowContext) => this.createSession(context),
        closeSession: (sessionId: string) => this.closeSession(sessionId),
        isActive: (sessionId: string) => this.isSessionActive(sessionId),
      },
      call: {
        createCall: (requestId: string, sessionId: string) => this.createCall(requestId, sessionId),
        connectCall: (callId: string) => this.connectCall(callId),
        finishCall: (callId: string) => this.finishCall(callId),
        failCall: (callId: string) => this.failCall(callId),
        isActive: (callId: string) => this.isCallActive(callId),
      },
      signaling: {
        prepare: (callId: string, sessionId: string) => this.prepare(callId, sessionId),
        removeListeners: () => this.removeListeners(),
      },
      rtc: {
        connect: (callId: string, sessionId: string) => this.connectRtc(callId, sessionId),
        reconnect: () => this.reconnectRtc(),
        close: () => this.closeRtc(),
        isPeerConnected: () => this.isPeerConnected(),
        hasMediaStreams: () => this.hasMediaStreams(),
      },
      dataChannel: {
        connect: (callId: string, sessionId: string) => this.connectDataChannel(callId, sessionId),
        reconnect: (callId: string, sessionId: string) =>
          this.reconnectDataChannel(callId, sessionId),
        close: (callId: string) => this.closeDataChannel(callId),
        isOpen: (callId: string) => this.isOpen(callId),
      },
      heartbeat: {
        start: (context: WorkflowContext) => this.startHeartbeat(context),
        stop: () => this.stopHeartbeat(),
        isHealthy: (context: WorkflowContext) => this.isHeartbeatHealthy(context),
      },
      screenSharing: {
        start: (context: WorkflowContext) => this.startScreen(context),
        stop: () => this.stopScreen(),
        isActive: () => this.isScreenActive(),
      },
      remoteControl: {
        authorize: (context: WorkflowContext) => this.authorize(context),
        sendCommand: (command: RemoteCommand) => this.sendCommand(command),
        revoke: () => this.revoke(),
        isActive: () => this.isRemoteActive(),
      },
    };
  }

  public connectParticipants(input: WorkflowStartInput): void {
    void input;
    this.operations.push('connection.connect');
    this.socketsConnected = true;
  }

  public recoverParticipants(context: WorkflowContext): void {
    void context;
    this.operations.push('connection.recover');
    this.socketsConnected = true;
    this.heartbeatHealthy = true;
  }

  public areSocketsConnected(context: WorkflowContext): boolean {
    void context;
    return this.socketsConnected;
  }

  public registerParticipants(input: WorkflowStartInput): void {
    void input;
    this.operations.push('presence.register');
    this.presenceReady = true;
  }

  public isReady(context: WorkflowContext): boolean {
    void context;
    return this.presenceReady;
  }

  public createRequest(context: WorkflowContext): string {
    void context;
    this.operations.push('request.create');
    return `request-${++this.requestIndex}`;
  }

  public acceptRequest(context: WorkflowContext, requestId: string): void {
    void context;
    void requestId;
    this.operations.push('request.accept');
  }

  public cancelTimers(): void {
    this.operations.push('request.timers.cancel');
  }

  public createSession(context: WorkflowContext): string {
    void context;
    this.operations.push('session.create');
    this.sessionActive = true;
    return `session-${++this.sessionIndex}`;
  }

  public closeSession(sessionId: string): void {
    void sessionId;
    this.operations.push('session.close');
    this.sessionActive = false;
  }

  public isSessionActive(sessionId: string): boolean {
    void sessionId;
    return this.sessionActive;
  }

  public createCall(requestId: string, sessionId: string): string {
    void requestId;
    void sessionId;
    this.operations.push('call.create');
    this.callActive = true;
    return `call-${++this.callIndex}`;
  }

  public connectCall(callId: string): void {
    void callId;
    this.operations.push('call.connect');
  }

  public finishCall(callId: string): void {
    void callId;
    this.operations.push('call.finish');
    this.callActive = false;
  }

  public failCall(callId: string): void {
    void callId;
    this.operations.push('call.fail');
    this.callActive = false;
  }

  public isCallActive(callId: string): boolean {
    void callId;
    return this.callActive;
  }

  public prepare(callId: string, sessionId: string): void {
    void callId;
    void sessionId;
    this.operations.push('signaling.prepare');
  }

  public removeListeners(): void {
    this.operations.push('signaling.listeners.remove');
  }

  public async connectRtc(callId: string, sessionId: string): Promise<void> {
    void callId;
    void sessionId;
    this.operations.push('rtc.connect');
    if (this.failNegotiation) {
      throw new Error('Falha simulada na negociação');
    }
    this.peerConnected = true;
    this.mediaStreams = true;
  }

  public async reconnectRtc(): Promise<void> {
    this.operations.push('rtc.reconnect');
    this.peerConnected = true;
    this.mediaStreams = true;
  }

  public async closeRtc(): Promise<void> {
    this.operations.push('rtc.close');
    this.peerConnected = false;
    this.mediaStreams = false;
    if (this.failRtcClose) {
      throw new Error('Falha simulada ao fechar RTC');
    }
  }

  public isPeerConnected(): boolean {
    return this.peerConnected;
  }

  public hasMediaStreams(): boolean {
    return this.mediaStreams;
  }

  public async connectDataChannel(callId: string, sessionId: string): Promise<void> {
    void callId;
    void sessionId;
    this.operations.push('data-channel.connect');
    this.dataChannelOpen = true;
  }

  public async reconnectDataChannel(callId: string, sessionId: string): Promise<void> {
    void callId;
    void sessionId;
    this.operations.push('data-channel.reconnect');
    this.dataChannelOpen = true;
  }

  public async closeDataChannel(callId: string): Promise<void> {
    void callId;
    this.operations.push('data-channel.close');
    this.dataChannelOpen = false;
  }

  public isOpen(callId: string): boolean {
    void callId;
    return this.dataChannelOpen;
  }

  public startHeartbeat(context: WorkflowContext): void {
    void context;
    this.operations.push('heartbeat.start');
    this.heartbeatHealthy = true;
  }

  public stopHeartbeat(): void {
    this.operations.push('heartbeat.stop');
    this.heartbeatHealthy = false;
  }

  public isHeartbeatHealthy(context: WorkflowContext): boolean {
    void context;
    return this.heartbeatHealthy;
  }

  public async startScreen(context: WorkflowContext): Promise<void> {
    void context;
    this.operations.push('screen.start');
    this.screenSharingActive = true;
  }

  public async stopScreen(): Promise<void> {
    this.operations.push('screen.stop');
    this.screenSharingActive = false;
  }

  public isScreenActive(): boolean {
    return this.screenSharingActive;
  }

  public async authorize(context: WorkflowContext): Promise<void> {
    void context;
    this.operations.push('remote.authorize');
    this.remoteControlActive = true;
  }

  public sendCommand(command: RemoteCommand): void {
    this.operations.push('remote.command');
    this.commands.push(command);
  }

  public async revoke(): Promise<void> {
    this.operations.push('remote.revoke');
    this.remoteControlActive = false;
  }

  public isRemoteActive(): boolean {
    return this.remoteControlActive;
  }

  public clear(workflowId: string): void {
    void workflowId;
    this.operations.push('memory.clear');
    this.presenceReady = false;
  }

  public removeWorkflowListeners(): void {
    this.operations.push('listeners.remove');
  }

  public dropConnection(): void {
    this.socketsConnected = false;
    this.heartbeatHealthy = false;
    this.peerConnected = false;
    this.mediaStreams = false;
    this.dataChannelOpen = false;
  }

  public hasOpenResources(): boolean {
    return (
      this.sessionActive ||
      this.callActive ||
      this.peerConnected ||
      this.mediaStreams ||
      this.dataChannelOpen ||
      this.heartbeatHealthy ||
      this.screenSharingActive ||
      this.remoteControlActive
    );
  }
}

function createCommand(): RemoteCommand {
  return {
    commandId: 'workflow-command',
    type: RemoteCommandType.KEY_DOWN,
    timestamp: new Date().toISOString(),
    payload: { code: 'KeyA', key: 'a', repeat: false },
  };
}

function countOperation(operations: readonly string[], operation: string): number {
  return operations.filter((current) => current === operation).length;
}
