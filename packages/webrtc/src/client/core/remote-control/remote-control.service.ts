import {
  EventType,
  RemoteControlFailureCode,
  type RemoteControlAuthorizationPayload,
  type RemoteControlFailedPayload,
  type RemoteControlReferencePayload,
  type RemoteControlRequestPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import type { WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import { REMOTE_CONTROL_EVENTS } from './remote.events.js';
import {
  RemoteControlState,
  type PermissionManagerPort,
  type RemoteCommand,
  type RemoteCommandTransportPayload,
  type RemoteControlContext,
  type RemoteControlManagerPort,
  type RemoteControlServiceOptions,
  type RemoteControlServicePort,
  type RemoteControlSignalingPort,
} from './remote.types.js';

export const DEFAULT_REMOTE_CONTROL_DURATION_MS = 5 * 60 * 1_000;

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class RemoteControlService implements RemoteControlServicePort {
  private readonly logger: WebRtcLogger;
  private readonly clock: () => Date;
  private readonly messageIdFactory: () => string;
  private notification = Promise.resolve();

  public constructor(
    private readonly permissionManager: PermissionManagerPort,
    private readonly manager: RemoteControlManagerPort,
    private readonly signaling: RemoteControlSignalingPort,
    options: RemoteControlServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.clock = options.clock ?? (() => new Date());
    this.messageIdFactory = options.messageIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.permissionManager.onExpired((context) => {
      this.enqueueNotification(() => this.sendExpired(context));
    });
  }

  public async request(
    callId: string,
    sessionId: string,
    durationMs = DEFAULT_REMOTE_CONTROL_DURATION_MS,
  ): Promise<void> {
    const context: RemoteControlContext = {
      callId,
      sessionId,
      authorizationId: this.messageIdFactory(),
      durationMs,
    };

    this.permissionManager.request(context);
    const payload: RemoteControlRequestPayload = {
      callId,
      authorizationId: context.authorizationId,
      durationMs,
    };

    await this.signaling.sendRequest(
      this.createMessage(REMOTE_CONTROL_EVENTS.request, payload, sessionId),
    );
    this.logger.info('Solicitação enviada', {
      callId,
      authorizationId: context.authorizationId,
    });
  }

  public receiveRequest(message: SocketMessage<RemoteControlRequestPayload>): void {
    const sessionId = this.requireEnvelope(message, EventType.REMOTE_REQUEST);

    this.permissionManager.request({
      callId: message.payload.callId,
      sessionId,
      authorizationId: message.payload.authorizationId,
      durationMs: message.payload.durationMs,
    });
  }

  public async accept(): Promise<void> {
    const context = this.requireContext();
    const expiresAt = new Date(this.clock().getTime() + context.durationMs).toISOString();

    this.permissionManager.authorize(expiresAt);
    const payload: RemoteControlAuthorizationPayload = {
      callId: context.callId,
      authorizationId: context.authorizationId,
      expiresAt,
    };
    await this.signaling.sendAccept(
      this.createMessage(REMOTE_CONTROL_EVENTS.accept, payload, context.sessionId),
    );
    this.logger.info('Solicitação aceita', {
      callId: context.callId,
      authorizationId: context.authorizationId,
      expiresAt,
    });
  }

  public async receiveAccept(
    message: SocketMessage<RemoteControlAuthorizationPayload>,
  ): Promise<void> {
    const context = this.requireMatchingMessage(message, EventType.REMOTE_ACCEPT);

    this.permissionManager.authorize(message.payload.expiresAt);
    this.logger.info('Solicitação aceita', {
      callId: context.callId,
      authorizationId: context.authorizationId,
      expiresAt: message.payload.expiresAt,
    });
    try {
      this.manager.start();
      await this.signaling.sendStarted(
        this.createReferenceMessage(REMOTE_CONTROL_EVENTS.started, context),
      );
    } catch (error) {
      await this.failAndNotify(context, RemoteControlFailureCode.TRANSPORT_FAILED, error);
      throw error;
    }
  }

  public async deny(): Promise<void> {
    const context = this.requireContext();

    this.permissionManager.deny();
    await this.signaling.sendDeny(this.createReferenceMessage(REMOTE_CONTROL_EVENTS.deny, context));
    this.logger.info('Solicitação recusada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
  }

  public receiveDeny(message: SocketMessage<RemoteControlReferencePayload>): void {
    const context = this.requireMatchingMessage(message, EventType.REMOTE_DENY);

    this.permissionManager.deny();
    this.logger.info('Solicitação recusada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
  }

  public receiveStarted(message: SocketMessage<RemoteControlReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.REMOTE_STARTED);
    this.manager.start();
  }

  public async stop(): Promise<void> {
    const context = this.requireContext();

    this.manager.stop();
    await this.signaling.sendStopped(
      this.createReferenceMessage(REMOTE_CONTROL_EVENTS.stopped, context),
    );
  }

  public revoke(): Promise<void> {
    return this.stop();
  }

  public receiveStopped(message: SocketMessage<RemoteControlReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.REMOTE_STOPPED);
    if (this.manager.getState() !== RemoteControlState.STOPPED) {
      this.manager.stop();
    }
  }

  public receiveExpired(message: SocketMessage<RemoteControlReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.REMOTE_EXPIRED);
    this.manager.expireRemote();
  }

  public receiveFailed(message: SocketMessage<RemoteControlFailedPayload>): void {
    this.requireMatchingMessage(message, EventType.REMOTE_FAILED);
    this.manager.fail();
    this.logger.error('Falhas', new Error(message.payload.message));
  }

  public sendCommand(command: RemoteCommand): SocketMessage<RemoteCommandTransportPayload> {
    return this.manager.sendCommand(command);
  }

  public getState(): RemoteControlState {
    return this.manager.getState();
  }

  private async sendExpired(context: RemoteControlContext): Promise<void> {
    await this.signaling.sendExpired(
      this.createReferenceMessage(REMOTE_CONTROL_EVENTS.expired, context),
    );
  }

  private async failAndNotify(
    context: RemoteControlContext,
    code: RemoteControlFailureCode,
    error: unknown,
  ): Promise<void> {
    this.manager.fail();
    this.logger.error('Falhas', error);
    const payload: RemoteControlFailedPayload = {
      callId: context.callId,
      authorizationId: context.authorizationId,
      code,
      message: 'Falha na sessão de controle remoto',
    };

    await this.signaling.sendFailed(
      this.createMessage(REMOTE_CONTROL_EVENTS.failed, payload, context.sessionId),
    );
  }

  private enqueueNotification(action: () => Promise<void>): void {
    this.notification = this.notification.then(action).catch((error: unknown) => {
      this.logger.error('Falhas', error);
    });
  }

  private requireMatchingMessage<TPayload extends RemoteControlReferencePayload>(
    message: SocketMessage<TPayload>,
    event: EventType,
  ): RemoteControlContext {
    const sessionId = this.requireEnvelope(message, event);
    const context = this.requireContext();

    if (
      context.callId !== message.payload.callId ||
      context.authorizationId !== message.payload.authorizationId ||
      context.sessionId !== sessionId
    ) {
      throw new Error('Mensagem não corresponde à autorização de controle remoto ativa');
    }

    return context;
  }

  private requireEnvelope<TPayload>(message: SocketMessage<TPayload>, event: EventType): string {
    if (
      message.event !== event ||
      message.id.trim().length === 0 ||
      Number.isNaN(Date.parse(message.timestamp))
    ) {
      throw new Error(`Envelope inválido para o evento ${event}`);
    }
    if (message.sessionId === undefined || message.sessionId.trim().length === 0) {
      throw new Error(`O evento ${event} exige sessionId`);
    }

    return message.sessionId;
  }

  private createReferenceMessage(
    event: EventType,
    context: RemoteControlContext,
  ): SocketMessage<RemoteControlReferencePayload> {
    const payload: RemoteControlReferencePayload = {
      callId: context.callId,
      authorizationId: context.authorizationId,
    };

    return this.createMessage(event, payload, context.sessionId);
  }

  private createMessage<TPayload>(
    event: EventType,
    payload: TPayload,
    sessionId: string,
  ): SocketMessage<TPayload> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      sessionId,
      payload,
    };
  }

  private requireContext(): RemoteControlContext {
    const context = this.permissionManager.getContext();

    if (context === undefined) {
      throw new Error('Solicitação de controle remoto não encontrada');
    }

    return context;
  }
}
