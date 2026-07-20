import { randomUUID } from 'node:crypto';

import {
  EventType,
  type RemoteControlAuthorizationPayload,
  type RemoteControlFailedPayload,
  type RemoteControlReferencePayload,
  type RemoteControlRequestPayload,
  type ScreenShareFailedPayload,
  type ScreenShareReferencePayload,
  type ScreenShareRequestPayload,
  type SignalAnswerPayload,
  type SignalErrorPayload,
  type SignalIceCandidatePayload,
  type SignalOfferPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import type {
  CommunicationServer,
  CommunicationSocket,
} from '../communication/communication.types.js';
import type {
  SignalMessageIdFactory,
  SignalingClock,
  SignalingEventType,
} from './signaling.types.js';

export class SignalingService {
  public constructor(
    private readonly clock: SignalingClock = () => new Date(),
    private readonly messageIdFactory: SignalMessageIdFactory = randomUUID,
  ) {}

  public sendOffer(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: SignalOfferPayload,
  ): SocketMessage<SignalOfferPayload> {
    const message = this.createMessage(EventType.SIGNAL_OFFER, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SIGNAL_OFFER, message);

    return message;
  }

  public sendAnswer(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: SignalAnswerPayload,
  ): SocketMessage<SignalAnswerPayload> {
    const message = this.createMessage(EventType.SIGNAL_ANSWER, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SIGNAL_ANSWER, message);

    return message;
  }

  public sendIceCandidate(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: SignalIceCandidatePayload,
  ): SocketMessage<SignalIceCandidatePayload> {
    const message = this.createMessage(EventType.SIGNAL_ICE_CANDIDATE, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SIGNAL_ICE_CANDIDATE, message);

    return message;
  }

  public sendScreenShareRequest(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareRequestPayload,
  ): SocketMessage<ScreenShareRequestPayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_REQUEST, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_REQUEST, message);
    return message;
  }

  public sendScreenShareAccept(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareReferencePayload,
  ): SocketMessage<ScreenShareReferencePayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_ACCEPT, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_ACCEPT, message);
    return message;
  }

  public sendScreenShareDeny(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareReferencePayload,
  ): SocketMessage<ScreenShareReferencePayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_DENY, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_DENY, message);
    return message;
  }

  public sendScreenShareStarted(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareReferencePayload,
  ): SocketMessage<ScreenShareReferencePayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_STARTED, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_STARTED, message);
    return message;
  }

  public sendScreenShareStopped(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareReferencePayload,
  ): SocketMessage<ScreenShareReferencePayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_STOPPED, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_STOPPED, message);
    return message;
  }

  public sendScreenShareFailed(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: ScreenShareFailedPayload,
  ): SocketMessage<ScreenShareFailedPayload> {
    const message = this.createMessage(EventType.SCREEN_SHARE_FAILED, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.SCREEN_SHARE_FAILED, message);
    return message;
  }

  public sendRemoteRequest(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: RemoteControlRequestPayload,
  ): SocketMessage<RemoteControlRequestPayload> {
    const message = this.createMessage(EventType.REMOTE_REQUEST, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.REMOTE_REQUEST, message);
    return message;
  }

  public sendRemoteAccept(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: RemoteControlAuthorizationPayload,
  ): SocketMessage<RemoteControlAuthorizationPayload> {
    const message = this.createMessage(EventType.REMOTE_ACCEPT, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.REMOTE_ACCEPT, message);
    return message;
  }

  public sendRemoteReference(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    event:
      | EventType.REMOTE_DENY
      | EventType.REMOTE_STARTED
      | EventType.REMOTE_STOPPED
      | EventType.REMOTE_EXPIRED,
    payload: RemoteControlReferencePayload,
  ): SocketMessage<RemoteControlReferencePayload> {
    const message = this.createMessage(event, payload, sessionId);

    switch (event) {
      case EventType.REMOTE_DENY:
        server.to(recipientConnectionId).emit(EventType.REMOTE_DENY, message);
        break;
      case EventType.REMOTE_STARTED:
        server.to(recipientConnectionId).emit(EventType.REMOTE_STARTED, message);
        break;
      case EventType.REMOTE_STOPPED:
        server.to(recipientConnectionId).emit(EventType.REMOTE_STOPPED, message);
        break;
      case EventType.REMOTE_EXPIRED:
        server.to(recipientConnectionId).emit(EventType.REMOTE_EXPIRED, message);
        break;
    }
    return message;
  }

  public sendRemoteFailed(
    server: CommunicationServer,
    recipientConnectionId: string,
    sessionId: string,
    payload: RemoteControlFailedPayload,
  ): SocketMessage<RemoteControlFailedPayload> {
    const message = this.createMessage(EventType.REMOTE_FAILED, payload, sessionId);

    server.to(recipientConnectionId).emit(EventType.REMOTE_FAILED, message);
    return message;
  }

  public sendError(
    socket: CommunicationSocket,
    relatedEvent: SignalingEventType,
    payload: Omit<SignalErrorPayload, 'relatedEvent'>,
    sessionId?: string,
  ): SocketMessage<SignalErrorPayload> {
    const message = this.createMessage(
      EventType.SIGNAL_ERROR,
      { ...payload, relatedEvent },
      sessionId,
    );

    socket.emit(EventType.SIGNAL_ERROR, message);

    return message;
  }

  private createMessage<T>(event: EventType, payload: T, sessionId?: string): SocketMessage<T> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      ...(sessionId === undefined ? {} : { sessionId }),
      payload,
    };
  }
}
