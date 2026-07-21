import { StateMachine, type StateTransition } from '@professor-connect/services/state-machine';

import type { RemoteCommand } from '../remote-control/remote.types.js';
import { WORKFLOW_STATE_TRANSITIONS, WorkflowEventType } from './workflow.events.js';
import {
  WorkflowHealthStatus,
  WorkflowState,
  type ResourceManagerPort,
  type ResourceReleaseReport,
  type WorkflowContext,
  type WorkflowDependencies,
  type WorkflowEvent,
  type WorkflowEventListener,
  type WorkflowHealthCheckPort,
  type WorkflowLogger,
  type WorkflowManagerOptions,
  type WorkflowManagerPort,
  type WorkflowStartInput,
  type WorkflowStateListener,
} from './workflow.types.js';

const silentLogger: WorkflowLogger = {
  info(): void {},
  error(): void {},
};

export class WorkflowManager implements WorkflowManagerPort {
  private readonly stateMachine: StateMachine<WorkflowState>;
  private readonly listeners = new Set<WorkflowEventListener>();
  private readonly logger: WorkflowLogger;
  private readonly clock: () => Date;
  private readonly workflowIdFactory: () => string;
  private context: WorkflowContext | undefined;

  public constructor(
    private readonly dependencies: WorkflowDependencies,
    private readonly resources: ResourceManagerPort,
    private readonly healthCheck: WorkflowHealthCheckPort,
    options: WorkflowManagerOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.clock = options.clock ?? (() => new Date());
    this.workflowIdFactory = options.workflowIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.stateMachine = new StateMachine(WorkflowState.IDLE, WORKFLOW_STATE_TRANSITIONS, {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      logger: this.logger,
      context: { component: 'attendance-workflow' },
    });
  }

  public async begin(input: WorkflowStartInput): Promise<WorkflowContext> {
    validateStartInput(input);
    const startedAt = this.clock().toISOString();

    this.context = {
      workflowId: this.workflowIdFactory(),
      student: input.student,
      teacher: input.teacher,
      startedAt,
    };
    this.stateMachine.transitionTo(WorkflowState.CONNECTING);
    this.logger.info('Início do atendimento', {
      workflowId: this.context.workflowId,
      startedAt,
    });

    try {
      await this.dependencies.connection.connectParticipants(input);
      await this.dependencies.presence.registerParticipants(input);
      await this.dependencies.heartbeat.start(this.context);
      this.emit(WorkflowEventType.ATTENDANCE_STARTED);

      const requestId = await this.dependencies.request.createRequest(this.context);

      this.updateContext({ requestId });
      this.stateMachine.transitionTo(WorkflowState.REQUESTED);
      this.emit(WorkflowEventType.REQUEST_CREATED);
      return this.requireContext();
    } catch (error) {
      await this.handleFailure(error);
      throw error;
    }
  }

  public async accept(): Promise<WorkflowContext> {
    const context = this.requireContext();
    const requestId = requireIdentifier(context.requestId, 'requestId');

    this.stateMachine.transitionTo(WorkflowState.PREPARING);
    try {
      await this.dependencies.request.acceptRequest(context, requestId);
      this.emit(WorkflowEventType.REQUEST_ACCEPTED);

      const sessionId = await this.dependencies.session.createSession(this.requireContext());

      this.updateContext({ sessionId });
      this.emit(WorkflowEventType.SESSION_CREATED);

      const callId = await this.dependencies.call.createCall(requestId, sessionId);

      this.updateContext({ callId, callStartedAt: this.clock().toISOString() });
      this.emit(WorkflowEventType.CALL_CREATED);
      await this.dependencies.signaling.prepare(callId, sessionId);
      this.emit(WorkflowEventType.SIGNALING_STARTED);
      this.stateMachine.transitionTo(WorkflowState.NEGOTIATING);

      await this.dependencies.rtc.connect(callId, sessionId);
      this.emit(WorkflowEventType.WEBRTC_CONNECTED);
      await this.dependencies.dataChannel.connect(callId, sessionId);
      this.emit(WorkflowEventType.DATA_CHANNEL_CONNECTED);
      this.emit(WorkflowEventType.MEDIA_STARTED);
      await this.dependencies.call.connectCall(callId);

      if (this.healthCheck.check(this.requireContext()).status !== WorkflowHealthStatus.HEALTHY) {
        throw new Error('Health Check reprovou a conexão integrada');
      }

      this.stateMachine.transitionTo(WorkflowState.ACTIVE);
      return this.requireContext();
    } catch (error) {
      await this.handleFailure(error);
      throw error;
    }
  }

  public async startScreenSharing(): Promise<void> {
    const context = this.requireActiveContext();

    await this.dependencies.screenSharing.start(context);
    this.emit(WorkflowEventType.SCREEN_SHARING_STARTED);
  }

  public async authorizeRemoteControl(): Promise<void> {
    const context = this.requireActiveContext();

    await this.dependencies.remoteControl.authorize(context);
    this.emit(WorkflowEventType.REMOTE_CONTROL_AUTHORIZED);
  }

  public sendRemoteCommand(command: RemoteCommand): void {
    this.requireActiveContext();
    this.dependencies.remoteControl.sendCommand(command);
  }

  public async recover(): Promise<void> {
    const context = this.requireActiveContext();
    const callId = requireIdentifier(context.callId, 'callId');
    const sessionId = requireIdentifier(context.sessionId, 'sessionId');

    this.stateMachine.transitionTo(WorkflowState.RECOVERING);
    this.emit(WorkflowEventType.CONNECTION_LOST);
    try {
      await this.dependencies.connection.recoverParticipants(context);
      await this.dependencies.rtc.reconnect();
      await this.dependencies.dataChannel.reconnect(callId, sessionId);
      if (this.healthCheck.check(context).status !== WorkflowHealthStatus.HEALTHY) {
        throw new Error('Health Check reprovou a recuperação do atendimento');
      }
      this.stateMachine.transitionTo(WorkflowState.ACTIVE);
      this.logger.info('Recuperações', { workflowId: context.workflowId, callId });
      this.emit(WorkflowEventType.RECOVERED);
    } catch (error) {
      await this.handleFailure(error);
      throw error;
    }
  }

  public async end(): Promise<ResourceReleaseReport> {
    const context = this.requireContext();

    if (this.getState() === WorkflowState.COMPLETED || this.getState() === WorkflowState.FAILED) {
      return this.resources.release(context);
    }
    this.stateMachine.transitionTo(WorkflowState.STOPPING);
    this.updateContext({ endedAt: this.clock().toISOString() });
    this.emit(WorkflowEventType.ATTENDANCE_FINISHED);
    const report = await this.resources.release(this.requireContext());

    if (report.failures.length > 0) {
      this.stateMachine.transitionTo(WorkflowState.FAILED);
      this.emit(
        WorkflowEventType.FAILED,
        new AggregateError(report.failures.map(({ error }) => error)),
      );
      return report;
    }

    this.stateMachine.transitionTo(WorkflowState.COMPLETED);
    this.logDurations(this.requireContext());
    this.emit(WorkflowEventType.RESOURCES_RELEASED);
    return report;
  }

  public getContext(): WorkflowContext | undefined {
    return this.context;
  }

  public getState(): WorkflowState {
    return this.stateMachine.getCurrentState();
  }

  public getStateHistory(): readonly StateTransition<WorkflowState>[] {
    return this.stateMachine.getHistory();
  }

  public onEvent(listener: WorkflowEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onStateChanged(listener: WorkflowStateListener): () => void {
    return this.stateMachine.onTransition(listener);
  }

  private async handleFailure(error: unknown): Promise<void> {
    const context = this.requireContext();
    const callId = context.callId;

    if (callId !== undefined && this.dependencies.call.isActive(callId)) {
      try {
        await this.dependencies.call.failCall(callId);
      } catch (callError) {
        this.logger.error('Falhas', callError);
      }
    }
    if (this.getState() !== WorkflowState.FAILED) {
      this.stateMachine.transitionTo(WorkflowState.FAILED);
    }
    this.logger.error('Falhas', error);
    this.emit(WorkflowEventType.FAILED, error);
    await this.resources.release(context);
  }

  private updateContext(update: Readonly<Partial<WorkflowContext>>): void {
    this.context = { ...this.requireContext(), ...update };
  }

  private emit(type: WorkflowEventType, error?: unknown): void {
    const context = this.requireContext();
    const event: WorkflowEvent = {
      type,
      workflowId: context.workflowId,
      timestamp: this.clock().toISOString(),
      context,
      ...(error === undefined ? {} : { error }),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private logDurations(context: WorkflowContext): void {
    const endedAt = Date.parse(requireIdentifier(context.endedAt, 'endedAt'));
    const sessionDurationMs = endedAt - Date.parse(context.startedAt);
    const callDurationMs =
      context.callStartedAt === undefined ? 0 : endedAt - Date.parse(context.callStartedAt);

    this.logger.info('Fim do atendimento', {
      workflowId: context.workflowId,
      sessionDurationMs,
      callDurationMs,
    });
    this.logger.info('Tempo da sessão', {
      workflowId: context.workflowId,
      durationMs: sessionDurationMs,
    });
    this.logger.info('Tempo da chamada', {
      workflowId: context.workflowId,
      durationMs: callDurationMs,
    });
  }

  private requireActiveContext(): WorkflowContext {
    if (this.getState() !== WorkflowState.ACTIVE) {
      throw new Error(`Atendimento não está ativo: ${this.getState()}`);
    }
    return this.requireContext();
  }

  private requireContext(): WorkflowContext {
    if (this.context === undefined) {
      throw new Error('Workflow de atendimento não iniciado');
    }
    return this.context;
  }
}

function validateStartInput(input: WorkflowStartInput): void {
  for (const client of [input.student, input.teacher]) {
    if (
      client.clientId.trim().length === 0 ||
      client.connectionId.trim().length === 0 ||
      client.displayName.trim().length === 0
    ) {
      throw new Error('Identificação dos participantes é obrigatória');
    }
  }
  if (input.student.clientId === input.teacher.clientId) {
    throw new Error('Aluno e professor devem ser participantes distintos');
  }
}

function requireIdentifier(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} não está disponível no workflow`);
  }
  return value;
}
