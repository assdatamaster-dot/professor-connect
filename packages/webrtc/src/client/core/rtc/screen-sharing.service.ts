import {
  EventType,
  type ScreenShareFailedPayload,
  type ScreenShareReferencePayload,
  type ScreenShareRequestPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import { SCREEN_SHARING_EVENTS } from './screen-sharing.events.js';
import type {
  ScreenSharingContext,
  ScreenSharingFailure,
  ScreenSharingManagerPort,
  ScreenSharingServiceOptions,
  ScreenSharingServicePort,
  ScreenSharingSignalingPort,
  ScreenSharingState,
} from './screen-sharing.types.js';
import type { WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class ScreenSharingService implements ScreenSharingServicePort {
  private readonly logger: WebRtcLogger;
  private readonly clock: () => Date;
  private readonly messageIdFactory: () => string;
  private notification = Promise.resolve();

  public constructor(
    private readonly manager: ScreenSharingManagerPort,
    private readonly signaling: ScreenSharingSignalingPort,
    options: ScreenSharingServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.clock = options.clock ?? (() => new Date());
    this.messageIdFactory = options.messageIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.manager.onLocalStopped((context) => {
      this.enqueueNotification(() => this.sendStopped(context));
    });
    this.manager.onLocalFailed((context, failure) => {
      this.enqueueNotification(() => this.sendFailed(context, failure));
    });
  }

  public async request(callId: string, sessionId: string): Promise<void> {
    const context: ScreenSharingContext = {
      callId,
      sessionId,
      requestId: this.messageIdFactory(),
    };

    this.manager.request(context);
    const payload: ScreenShareRequestPayload = {
      callId: context.callId,
      requestId: context.requestId,
    };

    await this.signaling.sendRequest(
      this.createMessage(SCREEN_SHARING_EVENTS.request, payload, context.sessionId),
    );
    this.logger.info('Solicitação enviada', {
      callId: context.callId,
      requestId: context.requestId,
    });
  }

  public receiveRequest(message: SocketMessage<ScreenShareRequestPayload>): void {
    const sessionId = this.requireEnvelope(message, EventType.SCREEN_SHARE_REQUEST);

    this.manager.request({
      callId: message.payload.callId,
      requestId: message.payload.requestId,
      sessionId,
    });
  }

  public async accept(): Promise<void> {
    const context = this.requireContext();

    await this.signaling.sendAccept(
      this.createReferenceMessage(SCREEN_SHARING_EVENTS.accept, context),
    );
    this.logger.info('Solicitação aceita', {
      callId: context.callId,
      requestId: context.requestId,
    });
    try {
      await this.manager.startLocal();
      await this.signaling.sendStarted(
        this.createReferenceMessage(SCREEN_SHARING_EVENTS.started, context),
      );
    } catch (error) {
      await this.notification;
      throw error;
    }
  }

  public receiveAccept(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.SCREEN_SHARE_ACCEPT);
    this.manager.acceptRemote();
    this.logger.info('Solicitação aceita', {
      callId: message.payload.callId,
      requestId: message.payload.requestId,
    });
  }

  public async deny(): Promise<void> {
    const context = this.requireContext();

    this.manager.deny();
    await this.signaling.sendDeny(this.createReferenceMessage(SCREEN_SHARING_EVENTS.deny, context));
    this.logger.info('Solicitação recusada', {
      callId: context.callId,
      requestId: context.requestId,
    });
  }

  public receiveDeny(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.SCREEN_SHARE_DENY);
    this.manager.deny();
    this.logger.info('Solicitação recusada', {
      callId: message.payload.callId,
      requestId: message.payload.requestId,
    });
  }

  public receiveStarted(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.SCREEN_SHARE_STARTED);
    this.manager.markStartedRemote();
  }

  public async stop(): Promise<void> {
    await this.manager.stopLocal();
    await this.notification;
  }

  public receiveStopped(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireMatchingMessage(message, EventType.SCREEN_SHARE_STOPPED);
    this.manager.markStoppedRemote();
  }

  public receiveFailed(message: SocketMessage<ScreenShareFailedPayload>): void {
    this.requireMatchingMessage(message, EventType.SCREEN_SHARE_FAILED);
    this.manager.failRemote();
    this.logger.error('Falhas', new Error(message.payload.message));
  }

  public getState(): ScreenSharingState {
    return this.manager.getState();
  }

  public isLocalSharing(): boolean {
    return this.manager.hasLocalCapture();
  }

  private async sendStopped(context: ScreenSharingContext): Promise<void> {
    await this.signaling.sendStopped(
      this.createReferenceMessage(SCREEN_SHARING_EVENTS.stopped, context),
    );
  }

  private async sendFailed(
    context: ScreenSharingContext,
    failure: ScreenSharingFailure,
  ): Promise<void> {
    const payload: ScreenShareFailedPayload = {
      callId: context.callId,
      requestId: context.requestId,
      code: failure.code,
      message: 'Falha ao iniciar ou manter o compartilhamento de tela',
    };

    await this.signaling.sendFailed(
      this.createMessage(SCREEN_SHARING_EVENTS.failed, payload, context.sessionId),
    );
  }

  private enqueueNotification(action: () => Promise<void>): void {
    this.notification = this.notification.then(action).catch((error: unknown) => {
      this.logger.error('Falhas', error);
    });
  }

  private requireMatchingMessage<TPayload extends ScreenShareReferencePayload>(
    message: SocketMessage<TPayload>,
    event: EventType,
  ): void {
    const sessionId = this.requireEnvelope(message, event);
    const context = this.requireContext();

    if (
      context.callId !== message.payload.callId ||
      context.requestId !== message.payload.requestId ||
      context.sessionId !== sessionId
    ) {
      throw new Error('Mensagem não corresponde à solicitação de compartilhamento ativa');
    }
  }

  private requireEnvelope<T>(message: SocketMessage<T>, event: EventType): string {
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
    context: ScreenSharingContext,
  ): SocketMessage<ScreenShareReferencePayload> {
    const payload: ScreenShareReferencePayload = {
      callId: context.callId,
      requestId: context.requestId,
    };

    return this.createMessage(event, payload, context.sessionId);
  }

  private createMessage<T>(event: EventType, payload: T, sessionId: string): SocketMessage<T> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      sessionId,
      payload,
    };
  }

  private requireContext(): ScreenSharingContext {
    const context = this.manager.getContext();

    if (context === undefined) {
      throw new Error('Solicitação de compartilhamento não encontrada');
    }

    return context;
  }
}
