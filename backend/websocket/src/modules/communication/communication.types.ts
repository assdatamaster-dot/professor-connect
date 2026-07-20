import type { Server, Socket } from 'socket.io';

import type {
  CallPayload,
  ConnectionLifecyclePayload,
  ConnectionRecoveryPayload,
  EventType,
  HeartbeatPingPayload,
  HeartbeatPongPayload,
  PresenceListPayload,
  PresenceQueryPayload,
  PresenceRegisterPayload,
  PresenceUpdatePayload,
  RequestCreatePayload,
  RequestPayload,
  RequestReferencePayload,
  RequestRejectedPayload,
  SessionClosePayload,
  SessionClosedPayload,
  SessionCreatedPayload,
  SessionCreatePayload,
  SessionJoinPayload,
  SessionLeavePayload,
  SocketMessage,
} from '@professor-connect/shared-types';
import type {
  SignalingClientToServerEvents,
  SignalingServerToClientEvents,
} from '../signaling/signaling.types.js';

export interface CommunicationPingPayload {
  readonly type: 'ping';
}

export interface CommunicationPongPayload {
  readonly type: 'pong';
}

export type PingMessage = SocketMessage<CommunicationPingPayload>;
export type PongResponse = SocketMessage<CommunicationPongPayload>;

export type ClientToServerEvents = SignalingClientToServerEvents & {
  [EventType.COMMUNICATION_PING]: (message: PingMessage) => void;
} & {
  [EventType.HEARTBEAT_PONG]: (message: SocketMessage<HeartbeatPongPayload>) => void;
} & {
  [EventType.SESSION_CREATE]: (message: SocketMessage<SessionCreatePayload>) => void;
} & {
  [EventType.SESSION_JOIN]: (message: SocketMessage<SessionJoinPayload>) => void;
} & {
  [EventType.SESSION_LEAVE]: (message: SocketMessage<SessionLeavePayload>) => void;
} & {
  [EventType.SESSION_CLOSE]: (message: SocketMessage<SessionClosePayload>) => void;
} & {
  [EventType.PRESENCE_REGISTER]: (message: SocketMessage<PresenceRegisterPayload>) => void;
} & {
  [EventType.PRESENCE_UPDATE]: (message: SocketMessage<PresenceUpdatePayload>) => void;
} & {
  [EventType.PRESENCE_ONLINE]: (message: SocketMessage<PresenceQueryPayload>) => void;
} & {
  [EventType.PRESENCE_AVAILABLE]: (message: SocketMessage<PresenceQueryPayload>) => void;
} & {
  [EventType.REQUEST_CREATE]: (message: SocketMessage<RequestCreatePayload>) => void;
} & {
  [EventType.REQUEST_ACCEPT]: (message: SocketMessage<RequestReferencePayload>) => void;
} & {
  [EventType.REQUEST_REJECT]: (message: SocketMessage<RequestReferencePayload>) => void;
} & {
  [EventType.REQUEST_CANCEL]: (message: SocketMessage<RequestReferencePayload>) => void;
};

export type ServerToClientEvents = SignalingServerToClientEvents & {
  [EventType.COMMUNICATION_PONG]: (response: PongResponse) => void;
} & {
  [EventType.HEARTBEAT_PING]: (message: SocketMessage<HeartbeatPingPayload>) => void;
} & {
  [EventType.CONNECTION_LOST]: (message: SocketMessage<ConnectionLifecyclePayload>) => void;
} & {
  [EventType.CONNECTION_TIMEOUT]: (message: SocketMessage<ConnectionLifecyclePayload>) => void;
} & {
  [EventType.CONNECTION_RECOVERED]: (message: SocketMessage<ConnectionRecoveryPayload>) => void;
} & {
  [EventType.SESSION_CREATED]: (message: SocketMessage<SessionCreatedPayload>) => void;
} & {
  [EventType.SESSION_CLOSED]: (message: SocketMessage<SessionClosedPayload>) => void;
} & {
  [EventType.PRESENCE_ONLINE]: (message: SocketMessage<PresenceListPayload>) => void;
} & {
  [EventType.PRESENCE_OFFLINE]: (message: SocketMessage<PresenceListPayload>) => void;
} & {
  [EventType.PRESENCE_AVAILABLE]: (message: SocketMessage<PresenceListPayload>) => void;
} & {
  [EventType.PRESENCE_BUSY]: (message: SocketMessage<PresenceListPayload>) => void;
} & {
  [EventType.REQUEST_CREATED]: (message: SocketMessage<RequestPayload>) => void;
} & {
  [EventType.REQUEST_RECEIVED]: (message: SocketMessage<RequestPayload>) => void;
} & {
  [EventType.REQUEST_ACCEPTED]: (message: SocketMessage<RequestPayload>) => void;
} & {
  [EventType.REQUEST_REJECTED]: (message: SocketMessage<RequestRejectedPayload>) => void;
} & {
  [EventType.REQUEST_CANCELLED]: (message: SocketMessage<RequestPayload>) => void;
} & {
  [EventType.REQUEST_EXPIRED]: (message: SocketMessage<RequestPayload>) => void;
} & {
  [EventType.CALL_CREATED]: (message: SocketMessage<CallPayload>) => void;
} & {
  [EventType.CALL_CONNECTING]: (message: SocketMessage<CallPayload>) => void;
} & {
  [EventType.CALL_CONNECTED]: (message: SocketMessage<CallPayload>) => void;
} & {
  [EventType.CALL_FINISHED]: (message: SocketMessage<CallPayload>) => void;
} & {
  [EventType.CALL_CANCELLED]: (message: SocketMessage<CallPayload>) => void;
} & {
  [EventType.CALL_FAILED]: (message: SocketMessage<CallPayload>) => void;
};

export interface CommunicationLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

type InterServerEvents = Record<never, never>;
type CommunicationSocketData = Record<never, never>;

export type CommunicationServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  CommunicationSocketData
>;

export type CommunicationSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  CommunicationSocketData
>;
