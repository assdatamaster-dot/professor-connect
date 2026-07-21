import { ConnectionState, ConnectionStatus } from '@professor-connect/protocol';

import type { ConnectedClient } from './connection.types.js';

type Clock = () => Date;

export class ConnectionManager {
  private readonly clients = new Map<string, ConnectedClient>();

  public constructor(private readonly clock: Clock = () => new Date()) {}

  public registerClient(clientId: string): ConnectedClient {
    const timestamp = this.clock().toISOString();
    const client: ConnectedClient = {
      id: clientId,
      connectedAt: timestamp,
      lastSeen: timestamp,
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.CONNECTED,
    };

    this.clients.set(clientId, client);

    return client;
  }

  public removeClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  public findClient(clientId: string): ConnectedClient | undefined {
    return this.clients.get(clientId);
  }

  public listClients(): readonly ConnectedClient[] {
    return [...this.clients.values()];
  }

  public hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  public recordHeartbeat(clientId: string): ConnectedClient | undefined {
    const client = this.findClient(clientId);

    if (client === undefined) {
      return undefined;
    }

    const refreshedClient: ConnectedClient = {
      ...client,
      lastSeen: this.clock().toISOString(),
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.CONNECTED,
    };

    this.clients.set(clientId, refreshedClient);

    return refreshedClient;
  }

  public markInactive(clientId: string): ConnectedClient | undefined {
    return this.updateClientState(clientId, ConnectionStatus.INACTIVE, ConnectionState.CONNECTED);
  }

  public markLost(clientId: string): ConnectedClient | undefined {
    return this.updateClientState(clientId, ConnectionStatus.INACTIVE, ConnectionState.LOST);
  }

  public recoverConnection(
    previousConnectionId: string,
    connectionId: string,
  ): ConnectedClient | undefined {
    const previousConnection = this.findClient(previousConnectionId);
    const currentConnection = this.findClient(connectionId);

    if (previousConnection === undefined || currentConnection === undefined) {
      return undefined;
    }

    const recoveredConnection: ConnectedClient = {
      ...currentConnection,
      connectedAt: previousConnection.connectedAt,
      lastSeen: this.clock().toISOString(),
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.RECOVERED,
    };

    this.clients.delete(previousConnectionId);
    this.clients.set(connectionId, recoveredConnection);

    return recoveredConnection;
  }

  public timeoutConnection(clientId: string): ConnectedClient | undefined {
    const timedOutClient = this.updateClientState(
      clientId,
      ConnectionStatus.CLOSED,
      ConnectionState.TIMED_OUT,
    );

    this.clients.delete(clientId);

    return timedOutClient;
  }

  private updateClientState(
    clientId: string,
    status: ConnectionStatus,
    connectionState: ConnectionState,
  ): ConnectedClient | undefined {
    const client = this.findClient(clientId);

    if (client === undefined) {
      return undefined;
    }

    const updatedClient: ConnectedClient = {
      ...client,
      status,
      connectionState,
    };

    this.clients.set(clientId, updatedClient);

    return updatedClient;
  }
}
