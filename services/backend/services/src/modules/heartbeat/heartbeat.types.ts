import type {
  Call,
  ClientPresence,
  ConnectionLifecyclePayload,
  ConnectionRecoveryPayload,
  ConnectionState,
  ConnectionStatus,
  EventType,
  ServiceRequest,
  Session,
} from '@professor-connect/protocol';

export interface HeartbeatSettings {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly reconnectWindowMs: number;
}

export interface HeartbeatClient {
  readonly clientId: string;
  readonly connectionId: string;
  readonly status: ConnectionStatus;
  readonly connectionState: ConnectionState;
  readonly connectedAt: string;
  readonly lastSeen: string;
  readonly lostAt?: string;
  readonly reconnectUntil?: string;
}

export interface HeartbeatInspection {
  readonly pingClients: readonly HeartbeatClient[];
  readonly inactiveClients: readonly HeartbeatClient[];
  readonly timedOutClients: readonly HeartbeatClient[];
}

export type HeartbeatClock = () => Date;

export interface ScheduledHeartbeatTask {
  cancel(): void;
}

export type HeartbeatScheduler = (
  task: () => void,
  intervalMilliseconds: number,
) => ScheduledHeartbeatTask;

export interface HeartbeatConnectionPort {
  recordHeartbeat(connectionId: string): void;
  markInactive(connectionId: string): void;
  markLost(connectionId: string): void;
  recoverConnection(previousConnectionId: string, connectionId: string): void;
  timeoutConnection(connectionId: string): void;
}

export interface HeartbeatPresencePort {
  updateLastSeenByConnection(connectionId: string): ClientPresence | undefined;
  markConnectionLost(connectionId: string): ClientPresence | undefined;
  recoverClient(clientId: string, connectionId: string): ClientPresence;
  timeoutClient(clientId: string): ClientPresence;
}

export interface ConnectionRecoveryResources {
  replaceSessionConnection(previousConnectionId: string, connectionId: string): readonly Session[];
  releaseSessions(connectionId: string): readonly Session[];
  listPendingRequests(clientId: string): readonly ServiceRequest[];
  listActiveCalls(clientId: string): readonly Call[];
}

export interface HeartbeatLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}

export type HeartbeatLifecycleEvent =
  | {
      readonly event: EventType.HEARTBEAT_PING;
      readonly connectionId: string;
    }
  | {
      readonly event: EventType.CONNECTION_LOST | EventType.CONNECTION_TIMEOUT;
      readonly payload: ConnectionLifecyclePayload;
    }
  | {
      readonly event: EventType.CONNECTION_RECOVERED;
      readonly payload: ConnectionRecoveryPayload;
    };

export type HeartbeatLifecycleListener = (event: HeartbeatLifecycleEvent) => void;
