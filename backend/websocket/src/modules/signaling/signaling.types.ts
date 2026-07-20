import type {
  Call,
  ClientPresence,
  EventType,
  RemoteControlAuthorizationPayload,
  RemoteControlFailedPayload,
  RemoteControlReferencePayload,
  RemoteControlRequestPayload,
  ScreenShareFailedPayload,
  ScreenShareReferencePayload,
  ScreenShareRequestPayload,
  Session,
  SignalAnswerPayload,
  SignalErrorCode,
  SignalErrorPayload,
  SignalIceCandidatePayload,
  SignalOfferPayload,
  SocketMessage,
} from '@professor-connect/shared-types';

export type SignalingEventType =
  | EventType.SIGNAL_OFFER
  | EventType.SIGNAL_ANSWER
  | EventType.SIGNAL_ICE_CANDIDATE
  | ScreenSharingEventType
  | RemoteControlAuthorizationEventType;

export type RemoteControlAuthorizationEventType =
  | EventType.REMOTE_REQUEST
  | EventType.REMOTE_ACCEPT
  | EventType.REMOTE_DENY
  | EventType.REMOTE_STARTED
  | EventType.REMOTE_STOPPED
  | EventType.REMOTE_EXPIRED
  | EventType.REMOTE_FAILED;

export type ScreenSharingEventType =
  | EventType.SCREEN_SHARE_REQUEST
  | EventType.SCREEN_SHARE_ACCEPT
  | EventType.SCREEN_SHARE_DENY
  | EventType.SCREEN_SHARE_STARTED
  | EventType.SCREEN_SHARE_STOPPED
  | EventType.SCREEN_SHARE_FAILED;

export type SignalingClientToServerEvents = {
  [EventType.SIGNAL_OFFER]: (message: SocketMessage<SignalOfferPayload>) => void;
} & {
  [EventType.SIGNAL_ANSWER]: (message: SocketMessage<SignalAnswerPayload>) => void;
} & {
  [EventType.SIGNAL_ICE_CANDIDATE]: (message: SocketMessage<SignalIceCandidatePayload>) => void;
} & {
  [EventType.SCREEN_SHARE_REQUEST]: (message: SocketMessage<ScreenShareRequestPayload>) => void;
} & {
  [EventType.SCREEN_SHARE_ACCEPT]: (message: SocketMessage<ScreenShareReferencePayload>) => void;
} & {
  [EventType.SCREEN_SHARE_DENY]: (message: SocketMessage<ScreenShareReferencePayload>) => void;
} & {
  [EventType.SCREEN_SHARE_STARTED]: (message: SocketMessage<ScreenShareReferencePayload>) => void;
} & {
  [EventType.SCREEN_SHARE_STOPPED]: (message: SocketMessage<ScreenShareReferencePayload>) => void;
} & {
  [EventType.SCREEN_SHARE_FAILED]: (message: SocketMessage<ScreenShareFailedPayload>) => void;
} & {
  [EventType.REMOTE_REQUEST]: (message: SocketMessage<RemoteControlRequestPayload>) => void;
} & {
  [EventType.REMOTE_ACCEPT]: (message: SocketMessage<RemoteControlAuthorizationPayload>) => void;
} & {
  [EventType.REMOTE_DENY]: (message: SocketMessage<RemoteControlReferencePayload>) => void;
} & {
  [EventType.REMOTE_STARTED]: (message: SocketMessage<RemoteControlReferencePayload>) => void;
} & {
  [EventType.REMOTE_STOPPED]: (message: SocketMessage<RemoteControlReferencePayload>) => void;
} & {
  [EventType.REMOTE_EXPIRED]: (message: SocketMessage<RemoteControlReferencePayload>) => void;
} & {
  [EventType.REMOTE_FAILED]: (message: SocketMessage<RemoteControlFailedPayload>) => void;
};

export type SignalingServerToClientEvents = SignalingClientToServerEvents & {
  [EventType.SIGNAL_ERROR]: (message: SocketMessage<SignalErrorPayload>) => void;
};

export interface SignalingSessionReader {
  findSession(sessionId: string): Session | undefined;
}

export interface SignalingCallReader {
  findCall(callId: string): Call | undefined;
}

export interface SignalingConnectionReader {
  isConnected(connectionId: string): boolean;
}

export interface SignalingPresenceReader {
  findByConnectionId(connectionId: string): ClientPresence | undefined;
}

export interface SignalingRouteRequest {
  readonly sessionId: string;
  readonly callId: string;
  readonly senderConnectionId: string;
}

export interface SignalingRoute {
  readonly recipientConnectionId: string;
}

export interface SignalingLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export type SignalingClock = () => Date;
export type SignalMessageIdFactory = () => string;

export class SignalingError extends Error {
  public constructor(
    public readonly code: SignalErrorCode,
    message: string,
  ) {
    super(message);
  }
}
