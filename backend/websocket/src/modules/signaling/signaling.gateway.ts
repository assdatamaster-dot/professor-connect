import {
  EventType,
  type RemoteControlReferencePayload,
  SignalErrorCode,
  type ScreenShareReferencePayload,
  type SignalIceCandidatePayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import type {
  CommunicationServer,
  CommunicationSocket,
} from '../communication/communication.types.js';
import { SIGNALING_EVENTS } from './signaling.events.js';
import type { SignalingManager } from './signaling.manager.js';
import type { SignalingService } from './signaling.service.js';
import type {
  RemoteControlAuthorizationEventType,
  ScreenSharingEventType,
  SignalingEventType,
  SignalingLogger,
} from './signaling.types.js';
import { SignalingError } from './signaling.types.js';

export class SignalingGateway {
  public constructor(
    private readonly server: CommunicationServer,
    private readonly signalingService: SignalingService,
    private readonly signalingManager: SignalingManager,
    private readonly logger: SignalingLogger,
  ) {}

  public registerEvents(): void {
    this.server.on(EventType.CONNECTION, (socket) => {
      this.registerSocketEvents(socket);
    });
  }

  private registerSocketEvents(socket: CommunicationSocket): void {
    socket.on(SIGNALING_EVENTS.offer, (message) => {
      this.handleSafely(socket, EventType.SIGNAL_OFFER, message.sessionId, () => {
        const sessionId = this.requireEnvelope(message, EventType.SIGNAL_OFFER);

        this.validateDescription(message.payload.callId, message.payload.sdp);
        this.logger.info('Offer recebida', {
          callId: message.payload.callId,
          sessionId,
          connectionId: socket.id,
        });

        const route = this.signalingManager.resolveRoute({
          sessionId,
          callId: message.payload.callId,
          senderConnectionId: socket.id,
        });

        this.signalingService.sendOffer(
          this.server,
          route.recipientConnectionId,
          sessionId,
          message.payload,
        );
        this.logger.info('Offer enviada', {
          callId: message.payload.callId,
          sessionId,
          connectionId: route.recipientConnectionId,
        });
      });
    });

    socket.on(SIGNALING_EVENTS.answer, (message) => {
      this.handleSafely(socket, EventType.SIGNAL_ANSWER, message.sessionId, () => {
        const sessionId = this.requireEnvelope(message, EventType.SIGNAL_ANSWER);

        this.validateDescription(message.payload.callId, message.payload.sdp);
        this.logger.info('Answer recebida', {
          callId: message.payload.callId,
          sessionId,
          connectionId: socket.id,
        });

        const route = this.signalingManager.resolveRoute({
          sessionId,
          callId: message.payload.callId,
          senderConnectionId: socket.id,
        });

        this.signalingService.sendAnswer(
          this.server,
          route.recipientConnectionId,
          sessionId,
          message.payload,
        );
        this.logger.info('Answer enviada', {
          callId: message.payload.callId,
          sessionId,
          connectionId: route.recipientConnectionId,
        });
      });
    });

    socket.on(SIGNALING_EVENTS.iceCandidate, (message) => {
      this.handleSafely(socket, EventType.SIGNAL_ICE_CANDIDATE, message.sessionId, () => {
        const sessionId = this.requireEnvelope(message, EventType.SIGNAL_ICE_CANDIDATE);

        this.validateIceCandidate(message.payload);
        this.logger.info('ICE recebido', {
          callId: message.payload.callId,
          sessionId,
          connectionId: socket.id,
        });

        const route = this.signalingManager.resolveRoute({
          sessionId,
          callId: message.payload.callId,
          senderConnectionId: socket.id,
        });

        this.signalingService.sendIceCandidate(
          this.server,
          route.recipientConnectionId,
          sessionId,
          message.payload,
        );
        this.logger.info('ICE enviado', {
          callId: message.payload.callId,
          sessionId,
          connectionId: route.recipientConnectionId,
        });
      });
    });

    socket.on(SIGNALING_EVENTS.screenShareRequest, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_REQUEST, message, (recipient, session) =>
        this.signalingService.sendScreenShareRequest(
          this.server,
          recipient,
          session,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.screenShareAccept, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_ACCEPT, message, (recipient, session) =>
        this.signalingService.sendScreenShareAccept(
          this.server,
          recipient,
          session,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.screenShareDeny, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_DENY, message, (recipient, session) =>
        this.signalingService.sendScreenShareDeny(this.server, recipient, session, message.payload),
      );
    });
    socket.on(SIGNALING_EVENTS.screenShareStarted, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_STARTED, message, (recipient, session) =>
        this.signalingService.sendScreenShareStarted(
          this.server,
          recipient,
          session,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.screenShareStopped, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_STOPPED, message, (recipient, session) =>
        this.signalingService.sendScreenShareStopped(
          this.server,
          recipient,
          session,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.screenShareFailed, (message) => {
      this.routeScreenShare(socket, EventType.SCREEN_SHARE_FAILED, message, (recipient, session) =>
        this.signalingService.sendScreenShareFailed(
          this.server,
          recipient,
          session,
          message.payload,
        ),
      );
    });

    socket.on(SIGNALING_EVENTS.remoteRequest, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_REQUEST, message, (recipient, session) =>
        this.signalingService.sendRemoteRequest(this.server, recipient, session, message.payload),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteAccept, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_ACCEPT, message, (recipient, session) =>
        this.signalingService.sendRemoteAccept(this.server, recipient, session, message.payload),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteDeny, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_DENY, message, (recipient, session) =>
        this.signalingService.sendRemoteReference(
          this.server,
          recipient,
          session,
          EventType.REMOTE_DENY,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteStarted, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_STARTED, message, (recipient, session) =>
        this.signalingService.sendRemoteReference(
          this.server,
          recipient,
          session,
          EventType.REMOTE_STARTED,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteStopped, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_STOPPED, message, (recipient, session) =>
        this.signalingService.sendRemoteReference(
          this.server,
          recipient,
          session,
          EventType.REMOTE_STOPPED,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteExpired, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_EXPIRED, message, (recipient, session) =>
        this.signalingService.sendRemoteReference(
          this.server,
          recipient,
          session,
          EventType.REMOTE_EXPIRED,
          message.payload,
        ),
      );
    });
    socket.on(SIGNALING_EVENTS.remoteFailed, (message) => {
      this.routeRemoteControl(socket, EventType.REMOTE_FAILED, message, (recipient, session) =>
        this.signalingService.sendRemoteFailed(this.server, recipient, session, message.payload),
      );
    });
  }

  private routeRemoteControl<TPayload extends RemoteControlReferencePayload>(
    socket: CommunicationSocket,
    event: RemoteControlAuthorizationEventType,
    message: SocketMessage<TPayload>,
    send: (recipientConnectionId: string, sessionId: string) => void,
  ): void {
    this.handleSafely(socket, event, message.sessionId, () => {
      const sessionId = this.requireEnvelope(message, event);

      this.validateRemoteControlReference(message.payload);
      if (
        event === EventType.REMOTE_REQUEST &&
        (!('durationMs' in message.payload) ||
          typeof message.payload.durationMs !== 'number' ||
          !Number.isInteger(message.payload.durationMs) ||
          message.payload.durationMs <= 0)
      ) {
        throw new SignalingError(
          SignalErrorCode.INVALID_MESSAGE,
          'durationMs deve ser um inteiro positivo',
        );
      }
      if (
        event === EventType.REMOTE_ACCEPT &&
        (!('expiresAt' in message.payload) ||
          typeof message.payload.expiresAt !== 'string' ||
          Number.isNaN(Date.parse(message.payload.expiresAt)))
      ) {
        throw new SignalingError(
          SignalErrorCode.INVALID_MESSAGE,
          'expiresAt deve ser uma data ISO',
        );
      }

      const route = this.signalingManager.resolveRoute({
        sessionId,
        callId: message.payload.callId,
        senderConnectionId: socket.id,
      });
      this.logger.info('Evento de controle remoto recebido', {
        event,
        callId: message.payload.callId,
        authorizationId: message.payload.authorizationId,
        sessionId,
        connectionId: socket.id,
      });
      send(route.recipientConnectionId, sessionId);
      this.logger.info('Evento de controle remoto enviado', {
        event,
        callId: message.payload.callId,
        authorizationId: message.payload.authorizationId,
        sessionId,
        connectionId: route.recipientConnectionId,
      });
    });
  }

  private routeScreenShare<TPayload extends ScreenShareReferencePayload>(
    socket: CommunicationSocket,
    event: ScreenSharingEventType,
    message: SocketMessage<TPayload>,
    send: (recipientConnectionId: string, sessionId: string) => void,
  ): void {
    this.handleSafely(socket, event, message.sessionId, () => {
      const sessionId = this.requireEnvelope(message, event);

      this.validateScreenShareReference(message.payload);
      const route = this.signalingManager.resolveRoute({
        sessionId,
        callId: message.payload.callId,
        senderConnectionId: socket.id,
      });

      this.logger.info('Evento de compartilhamento recebido', {
        event,
        callId: message.payload.callId,
        requestId: message.payload.requestId,
        sessionId,
        connectionId: socket.id,
      });
      send(route.recipientConnectionId, sessionId);
      this.logger.info('Evento de compartilhamento enviado', {
        event,
        callId: message.payload.callId,
        requestId: message.payload.requestId,
        sessionId,
        connectionId: route.recipientConnectionId,
      });
    });
  }

  private validateScreenShareReference(payload: ScreenShareReferencePayload): void {
    this.requireNonEmpty(payload.callId, 'callId');
    this.requireNonEmpty(payload.requestId, 'requestId');
  }

  private validateRemoteControlReference(payload: RemoteControlReferencePayload): void {
    this.requireNonEmpty(payload.callId, 'callId');
    this.requireNonEmpty(payload.authorizationId, 'authorizationId');
  }

  private validateDescription(callId: string, sdp: string): void {
    this.requireNonEmpty(callId, 'callId');
    this.requireNonEmpty(sdp, 'sdp');
  }

  private validateIceCandidate(payload: SignalIceCandidatePayload): void {
    this.requireNonEmpty(payload.callId, 'callId');
    this.requireNonEmpty(payload.candidate, 'candidate');

    if (
      payload.sdpMLineIndex !== undefined &&
      payload.sdpMLineIndex !== null &&
      (!Number.isInteger(payload.sdpMLineIndex) || payload.sdpMLineIndex < 0)
    ) {
      throw new SignalingError(
        SignalErrorCode.INVALID_MESSAGE,
        'sdpMLineIndex deve ser um inteiro não negativo',
      );
    }
  }

  private requireNonEmpty(value: string, fieldName: string): void {
    if (value.trim().length === 0) {
      throw new SignalingError(SignalErrorCode.INVALID_MESSAGE, `${fieldName} é obrigatório`);
    }
  }

  private requireEnvelope<T>(message: SocketMessage<T>, event: SignalingEventType): string {
    if (message.event !== event) {
      throw new SignalingError(
        SignalErrorCode.INVALID_MESSAGE,
        `Evento inválido no envelope: esperado ${event}`,
      );
    }

    if (message.id.trim().length === 0 || Number.isNaN(Date.parse(message.timestamp))) {
      throw new SignalingError(
        SignalErrorCode.INVALID_MESSAGE,
        `Envelope inválido para o evento ${event}`,
      );
    }

    if (message.sessionId === undefined || message.sessionId.trim().length === 0) {
      throw new SignalingError(
        SignalErrorCode.INVALID_MESSAGE,
        `O evento ${event} exige sessionId`,
      );
    }

    return message.sessionId;
  }

  private handleSafely(
    socket: CommunicationSocket,
    event: SignalingEventType,
    sessionId: string | undefined,
    action: () => void,
  ): void {
    try {
      action();
    } catch (error) {
      const signalingError =
        error instanceof SignalingError
          ? error
          : new SignalingError(SignalErrorCode.INVALID_MESSAGE, 'Mensagem de sinalização inválida');

      this.logger.error('Erro de sinalização', error);
      this.signalingService.sendError(
        socket,
        event,
        { code: signalingError.code, message: signalingError.message },
        sessionId,
      );
    }
  }
}
