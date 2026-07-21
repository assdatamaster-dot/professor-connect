import type { Call } from './call.js';
import type { ClientPresence } from './presence.js';
import type { ServiceRequest } from './request.js';
import type { Session } from './session.js';

export enum ConnectionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CLOSED = 'CLOSED',
}

export enum ConnectionState {
  CONNECTED = 'CONNECTED',
  LOST = 'LOST',
  RECOVERED = 'RECOVERED',
  TIMED_OUT = 'TIMED_OUT',
}

export interface HeartbeatPingPayload {
  readonly type: 'ping';
}

export interface HeartbeatPongPayload {
  readonly type: 'pong';
}

export interface ConnectionLifecyclePayload {
  readonly clientId: string;
  readonly connectionId: string;
  readonly connectionState: ConnectionState;
  readonly lastSeen: string;
}

export interface ConnectionRecoveryPayload extends ConnectionLifecyclePayload {
  readonly previousConnectionId: string;
  readonly presence: ClientPresence;
  readonly sessions: readonly Session[];
  readonly requests: readonly ServiceRequest[];
  readonly calls: readonly Call[];
}
