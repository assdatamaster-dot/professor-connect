import { StateMachine, type StateTransition } from '@professor-connect/services/state-machine';
import type { ServiceRequest } from '@professor-connect/protocol';

import { END_TO_END_STATE_TRANSITIONS, EndToEndEventType } from './integration.events.js';
import {
  EndToEndResource,
  EndToEndRole,
  EndToEndState,
  type EndToEndAttendance,
  type EndToEndClient,
  type EndToEndEvent,
  type EndToEndEventListener,
  type EndToEndLogger,
  type EndToEndManagerOptions,
  type EndToEndManagerPort,
  type EndToEndResourceManagerPort,
  type EndToEndResourceReleaseReport,
  type EndToEndSnapshot,
  type EndToEndStateListener,
  type EndToEndWorkflowPort,
} from './integration.types.js';

const REQUIRED_RESOURCES: ReadonlySet<EndToEndResource> = new Set(Object.values(EndToEndResource));

const silentLogger: EndToEndLogger = {
  info(): void {},
  error(): void {},
};

export class EndToEndManager implements EndToEndManagerPort {
  private readonly stateMachine: StateMachine<EndToEndState>;
  private readonly listeners = new Set<EndToEndEventListener>();
  private readonly logger: EndToEndLogger;
  private readonly clock: () => Date;
  private client: EndToEndClient | undefined;
  private onlineStudents: EndToEndSnapshot['onlineStudents'] = [];
  private pendingRequests: ServiceRequest[] = [];
  private attendance: EndToEndAttendance | undefined;
  private pendingRequestId: string | undefined;
  private hasAudio = false;
  private hasVideo = false;
  private isSharingScreen = false;

  public constructor(
    private readonly workflow: EndToEndWorkflowPort,
    private readonly resources: EndToEndResourceManagerPort,
    options: EndToEndManagerOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.clock = options.clock ?? (() => new Date());
    this.stateMachine = new StateMachine(EndToEndState.DISCONNECTED, END_TO_END_STATE_TRANSITIONS, {
      clock: this.clock,
      logger: this.logger,
      context: { component: 'end-to-end-integration' },
    });
  }

  public async connect(client: EndToEndClient): Promise<EndToEndSnapshot> {
    validateClient(client);
    this.requireState(EndToEndState.DISCONNECTED, EndToEndState.FAILED);
    this.client = client;
    this.stateMachine.transitionTo(EndToEndState.CONNECTING);

    try {
      await this.workflow.connect(client);
      this.logger.info('Conexão', { clientId: client.clientId, role: client.role });
      this.emit(EndToEndEventType.CONNECTION_ESTABLISHED);
      await this.workflow.registerPresence(client);
      this.logger.info('Presence', { clientId: client.clientId, role: client.role });
      this.emit(EndToEndEventType.PRESENCE_REGISTERED);
      this.onlineStudents = await this.workflow.listOnlineStudents();
      this.emit(EndToEndEventType.STUDENTS_UPDATED);
      this.stateMachine.transitionTo(EndToEndState.CONNECTED);
      return this.getSnapshot();
    } catch (error) {
      return this.fail(error);
    }
  }

  public async callProfessor(): Promise<ServiceRequest> {
    this.requireRole(EndToEndRole.STUDENT);
    this.requireState(EndToEndState.CONNECTED);
    this.stateMachine.transitionTo(EndToEndState.CALLING);

    try {
      const request = await this.workflow.createRequest();

      this.pendingRequestId = request.requestId;
      this.pendingRequests = [request];
      this.logger.info('Request', { requestId: request.requestId });
      this.emit(EndToEndEventType.REQUEST_CREATED);
      return request;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public receiveRequest(request: ServiceRequest): void {
    this.requireRole(EndToEndRole.TEACHER);
    this.requireState(EndToEndState.CONNECTED);
    if (!this.pendingRequests.some(({ requestId }) => requestId === request.requestId)) {
      this.pendingRequests = [...this.pendingRequests, request];
    }
    this.logger.info('Request recebida', { requestId: request.requestId });
    this.emit(EndToEndEventType.REQUEST_RECEIVED);
  }

  public async acceptRequest(requestId: string): Promise<EndToEndAttendance> {
    this.requireRole(EndToEndRole.TEACHER);
    this.requirePendingRequest(requestId);
    this.requireState(EndToEndState.CONNECTED);
    this.stateMachine.transitionTo(EndToEndState.PREPARING);

    try {
      const attendance = await this.workflow.acceptRequest(requestId);

      this.pendingRequests = this.pendingRequests.filter(
        (request) => request.requestId !== requestId,
      );
      this.emit(EndToEndEventType.REQUEST_ACCEPTED);
      await this.activateAttendance(attendance, true);
      return attendance;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public async receiveAcceptedAttendance(attendance: EndToEndAttendance): Promise<void> {
    this.requireRole(EndToEndRole.STUDENT);
    this.requireState(EndToEndState.CALLING);
    if (this.pendingRequestId !== attendance.requestId) {
      throw new Error('Atendimento não corresponde à Request pendente');
    }
    this.stateMachine.transitionTo(EndToEndState.PREPARING);
    this.emit(EndToEndEventType.REQUEST_ACCEPTED);

    try {
      await this.activateAttendance(attendance, false);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public async rejectRequest(requestId: string): Promise<void> {
    this.requireRole(EndToEndRole.TEACHER);
    this.requirePendingRequest(requestId);
    this.requireState(EndToEndState.CONNECTED);
    await this.workflow.rejectRequest(requestId);
    this.pendingRequests = this.pendingRequests.filter(
      (request) => request.requestId !== requestId,
    );
    this.logger.info('Request recusada', { requestId });
    this.emit(EndToEndEventType.REQUEST_REJECTED);
  }

  public async shareScreen(): Promise<void> {
    this.requireState(EndToEndState.IN_ATTENDANCE);
    const attendance = this.requireAttendance();

    try {
      await this.workflow.startScreenSharing(attendance);
      this.isSharingScreen = true;
      this.stateMachine.transitionTo(EndToEndState.SHARING);
      this.logger.info('Compartilhamento', { callId: attendance.callId });
      this.emit(EndToEndEventType.SCREEN_SHARING_STARTED);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public async reconnect(): Promise<void> {
    this.requireState(EndToEndState.IN_ATTENDANCE, EndToEndState.SHARING);
    const attendance = this.requireAttendance();

    this.stateMachine.transitionTo(EndToEndState.RECONNECTING);
    this.isSharingScreen = false;
    this.emit(EndToEndEventType.CONNECTION_LOST);
    try {
      await this.workflow.reconnectRtc(attendance);
      this.validateMedia();
      this.stateMachine.transitionTo(EndToEndState.IN_ATTENDANCE);
      this.logger.info('WebRTC reconectado', { callId: attendance.callId });
      this.emit(EndToEndEventType.RECONNECTED);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  public async endAttendance(): Promise<EndToEndResourceReleaseReport> {
    this.requireState(
      EndToEndState.CALLING,
      EndToEndState.PREPARING,
      EndToEndState.IN_ATTENDANCE,
      EndToEndState.SHARING,
      EndToEndState.RECONNECTING,
    );
    this.stateMachine.transitionTo(EndToEndState.STOPPING);

    const report = await this.resources.release(this.attendance, this.pendingRequestId);

    if (report.failures.length > 0 || !hasReleasedEverything(report)) {
      const error = new AggregateError(
        report.failures.map(({ error }) => error),
        'Liberação incompleta dos recursos do atendimento',
      );

      this.fail(error);
      return report;
    }

    this.logger.info('Encerramento', {
      callId: this.attendance?.callId,
      sessionId: this.attendance?.sessionId,
    });
    this.emit(EndToEndEventType.ATTENDANCE_ENDED);
    this.clearAttendance();
    this.stateMachine.transitionTo(EndToEndState.CONNECTED);
    this.emit(EndToEndEventType.RESOURCES_RELEASED);
    return report;
  }

  public async disconnect(): Promise<void> {
    if (
      this.getSnapshot().state !== EndToEndState.CONNECTED &&
      this.getSnapshot().state !== EndToEndState.DISCONNECTED
    ) {
      await this.endAttendance();
    }
    if (this.getSnapshot().state === EndToEndState.DISCONNECTED) {
      return;
    }
    this.stateMachine.transitionTo(EndToEndState.STOPPING);
    await this.workflow.disconnect();
    this.client = undefined;
    this.onlineStudents = [];
    this.pendingRequests = [];
    this.stateMachine.transitionTo(EndToEndState.DISCONNECTED);
    this.emit(EndToEndEventType.DISCONNECTED);
  }

  public getSnapshot(): EndToEndSnapshot {
    return {
      state: this.stateMachine.getCurrentState(),
      client: this.client,
      onlineStudents: [...this.onlineStudents],
      pendingRequests: [...this.pendingRequests],
      attendance: this.attendance,
      hasAudio: this.hasAudio,
      hasVideo: this.hasVideo,
      isSharingScreen: this.isSharingScreen,
    };
  }

  public getStateHistory(): readonly StateTransition<EndToEndState>[] {
    return this.stateMachine.getHistory();
  }

  public onEvent(listener: EndToEndEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onStateChanged(listener: EndToEndStateListener): () => void {
    return this.stateMachine.onTransition(listener);
  }

  private async activateAttendance(
    attendance: EndToEndAttendance,
    initiator: boolean,
  ): Promise<void> {
    validateAttendance(attendance);
    this.attendance = attendance;
    this.pendingRequestId = undefined;
    this.pendingRequests = [];
    this.logger.info('Session', { sessionId: attendance.sessionId });
    this.emit(EndToEndEventType.SESSION_CREATED);
    this.logger.info('Call', { callId: attendance.callId });
    this.emit(EndToEndEventType.CALL_CREATED);
    await this.workflow.prepareSignaling(attendance);
    this.logger.info('Signaling', { callId: attendance.callId });
    this.emit(EndToEndEventType.SIGNALING_STARTED);
    await this.workflow.connectRtc(attendance, initiator);
    this.logger.info('WebRTC', { callId: attendance.callId });
    this.emit(EndToEndEventType.WEBRTC_CONNECTED);
    this.validateMedia();
    this.stateMachine.transitionTo(EndToEndState.IN_ATTENDANCE);
  }

  private validateMedia(): void {
    this.hasAudio = this.workflow.hasAudio();
    this.hasVideo = this.workflow.hasVideo();
    if (!this.hasAudio || !this.hasVideo) {
      throw new Error('Áudio e vídeo devem estar disponíveis no atendimento');
    }
    this.logger.info('Áudio iniciado');
    this.emit(EndToEndEventType.AUDIO_STARTED);
    this.logger.info('Vídeo iniciado');
    this.emit(EndToEndEventType.VIDEO_STARTED);
  }

  private clearAttendance(): void {
    this.attendance = undefined;
    this.pendingRequestId = undefined;
    this.pendingRequests = [];
    this.hasAudio = false;
    this.hasVideo = false;
    this.isSharingScreen = false;
  }

  private requireAttendance(): EndToEndAttendance {
    if (this.attendance === undefined) {
      throw new Error('Atendimento ainda não foi criado');
    }
    return this.attendance;
  }

  private requirePendingRequest(requestId: string): ServiceRequest {
    const request = this.pendingRequests.find((item) => item.requestId === requestId);

    if (request === undefined) {
      throw new Error(`Request pendente não encontrada: ${requestId}`);
    }
    return request;
  }

  private requireRole(role: EndToEndRole): void {
    if (this.client?.role !== role) {
      throw new Error(`Operação exige o papel ${role}`);
    }
  }

  private requireState(...states: readonly EndToEndState[]): void {
    const state = this.stateMachine.getCurrentState();

    if (!states.includes(state)) {
      throw new Error(`Estado inválido para a operação: ${state}`);
    }
  }

  private emit(type: EndToEndEventType, error?: unknown): void {
    const event: EndToEndEvent = {
      type,
      timestamp: this.clock().toISOString(),
      snapshot: this.getSnapshot(),
      ...(error === undefined ? {} : { error }),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private fail(error: unknown): EndToEndSnapshot {
    const state = this.stateMachine.getCurrentState();

    if (state !== EndToEndState.FAILED) {
      this.stateMachine.transitionTo(EndToEndState.FAILED);
    }
    this.logger.error('Falhas', error);
    this.emit(EndToEndEventType.FAILED, error);
    return this.getSnapshot();
  }
}

function validateClient(client: EndToEndClient): void {
  if (client.clientId.trim().length === 0 || client.displayName.trim().length === 0) {
    throw new Error('Identificação do cliente é obrigatória');
  }
}

function validateAttendance(attendance: EndToEndAttendance): void {
  const identifiers = [
    attendance.requestId,
    attendance.sessionId,
    attendance.callId,
    attendance.studentId,
    attendance.teacherId,
  ];

  if (identifiers.some((identifier) => identifier.trim().length === 0)) {
    throw new Error('Atendimento possui identificadores inválidos');
  }
}

function hasReleasedEverything(report: EndToEndResourceReleaseReport): boolean {
  const released = new Set(report.released);

  return [...REQUIRED_RESOURCES].every((resource) => released.has(resource));
}
