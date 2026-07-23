import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
} from '@professor-connect/protocol';

export type RemoteControlStatus = 'inactive' | 'pending' | 'active';

export interface RemoteControlLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly message: string;
}

export interface TeacherRemoteControlSnapshot {
  readonly status: RemoteControlStatus;
  readonly sessionId: string | undefined;
  readonly requestId: string | undefined;
  readonly logs: readonly RemoteControlLogEntry[];
}

export type { RemoteControlKeyboardEvent, RemoteControlMouseEvent };
