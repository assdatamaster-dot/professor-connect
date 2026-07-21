import type { ConnectionState, ConnectionStatus } from '@professor-connect/protocol';

export interface ConnectedClient {
  readonly id: string;
  readonly connectedAt: string;
  readonly lastSeen: string;
  readonly status: ConnectionStatus;
  readonly connectionState: ConnectionState;
}
