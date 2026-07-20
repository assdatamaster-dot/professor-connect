import { ConnectionState, ConnectionStatus } from '@professor-connect/shared-types';

import type {
  HeartbeatClient,
  HeartbeatClock,
  HeartbeatInspection,
  HeartbeatSettings,
} from './heartbeat.types.js';

export class HeartbeatManager {
  private readonly clients = new Map<string, HeartbeatClient>();
  private readonly clientIdsByConnection = new Map<string, string>();

  public constructor(
    private readonly settings: HeartbeatSettings,
    private readonly clock: HeartbeatClock = () => new Date(),
  ) {}

  public registerClient(clientId: string, connectionId: string): HeartbeatClient {
    const existingClient = this.findClient(clientId);

    if (existingClient !== undefined) {
      throw new Error(`Cliente já possui registro de heartbeat: ${clientId}`);
    }

    const timestamp = this.clock().toISOString();
    const client: HeartbeatClient = {
      clientId,
      connectionId,
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.CONNECTED,
      connectedAt: timestamp,
      lastSeen: timestamp,
    };

    this.clients.set(clientId, client);
    this.clientIdsByConnection.set(connectionId, clientId);

    return client;
  }

  public recordHeartbeat(connectionId: string): HeartbeatClient | undefined {
    const client = this.findByConnectionId(connectionId);

    if (client === undefined || client.connectionState === ConnectionState.LOST) {
      return undefined;
    }

    const updatedClient: HeartbeatClient = {
      clientId: client.clientId,
      connectionId,
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.CONNECTED,
      connectedAt: client.connectedAt,
      lastSeen: this.clock().toISOString(),
    };

    return this.saveClient(updatedClient);
  }

  public markConnectionLost(connectionId: string): HeartbeatClient | undefined {
    const client = this.findByConnectionId(connectionId);

    if (client === undefined) {
      return undefined;
    }

    const lostAt = this.clock();
    const timeoutDeadline = Date.parse(client.lastSeen) + this.settings.timeoutMs;
    const reconnectDeadline = lostAt.getTime() + this.settings.reconnectWindowMs;
    const updatedClient: HeartbeatClient = {
      ...client,
      status: ConnectionStatus.INACTIVE,
      connectionState: ConnectionState.LOST,
      lostAt: lostAt.toISOString(),
      reconnectUntil: new Date(Math.min(timeoutDeadline, reconnectDeadline)).toISOString(),
    };

    return this.saveClient(updatedClient);
  }

  public recoverClient(clientId: string, connectionId: string): HeartbeatClient | undefined {
    const client = this.findClient(clientId);
    const now = this.clock();

    if (
      client === undefined ||
      client.connectionState !== ConnectionState.LOST ||
      client.reconnectUntil === undefined ||
      now.getTime() >= Date.parse(client.reconnectUntil) ||
      now.getTime() - Date.parse(client.lastSeen) >= this.settings.timeoutMs
    ) {
      return undefined;
    }

    this.clientIdsByConnection.delete(client.connectionId);

    const recoveredClient: HeartbeatClient = {
      clientId,
      connectionId,
      status: ConnectionStatus.ACTIVE,
      connectionState: ConnectionState.RECOVERED,
      connectedAt: client.connectedAt,
      lastSeen: now.toISOString(),
    };

    this.clientIdsByConnection.set(connectionId, clientId);

    return this.saveClient(recoveredClient);
  }

  public inspectConnections(): HeartbeatInspection {
    const now = this.clock().getTime();
    const pingClients: HeartbeatClient[] = [];
    const inactiveClients: HeartbeatClient[] = [];
    const timedOutClients: HeartbeatClient[] = [];

    for (const client of this.clients.values()) {
      const elapsedSinceLastSeen = now - Date.parse(client.lastSeen);
      const reconnectExpired =
        client.connectionState === ConnectionState.LOST &&
        client.reconnectUntil !== undefined &&
        now >= Date.parse(client.reconnectUntil);

      if (elapsedSinceLastSeen >= this.settings.timeoutMs || reconnectExpired) {
        timedOutClients.push(this.markTimedOut(client));
        continue;
      }

      if (client.connectionState === ConnectionState.LOST) {
        continue;
      }

      if (
        elapsedSinceLastSeen >= this.settings.intervalMs &&
        client.status === ConnectionStatus.ACTIVE
      ) {
        const inactiveClient: HeartbeatClient = {
          ...client,
          status: ConnectionStatus.INACTIVE,
        };

        this.saveClient(inactiveClient);
        inactiveClients.push(inactiveClient);
        pingClients.push(inactiveClient);
        continue;
      }

      pingClients.push(client);
    }

    return { pingClients, inactiveClients, timedOutClients };
  }

  public timeoutIfExpired(clientId: string): HeartbeatClient | undefined {
    const client = this.findClient(clientId);

    if (client === undefined) {
      return undefined;
    }

    const now = this.clock().getTime();
    const reconnectExpired =
      client.reconnectUntil !== undefined && now >= Date.parse(client.reconnectUntil);
    const heartbeatExpired = now - Date.parse(client.lastSeen) >= this.settings.timeoutMs;

    return reconnectExpired || heartbeatExpired ? this.markTimedOut(client) : undefined;
  }

  public findClient(clientId: string): HeartbeatClient | undefined {
    return this.clients.get(clientId);
  }

  public findByConnectionId(connectionId: string): HeartbeatClient | undefined {
    const clientId = this.clientIdsByConnection.get(connectionId);

    return clientId === undefined ? undefined : this.findClient(clientId);
  }

  public listClients(): readonly HeartbeatClient[] {
    return [...this.clients.values()];
  }

  public removeClient(clientId: string): boolean {
    const client = this.findClient(clientId);

    if (client !== undefined) {
      this.clientIdsByConnection.delete(client.connectionId);
    }

    return this.clients.delete(clientId);
  }

  private markTimedOut(client: HeartbeatClient): HeartbeatClient {
    const timedOutClient: HeartbeatClient = {
      ...client,
      status: ConnectionStatus.CLOSED,
      connectionState: ConnectionState.TIMED_OUT,
    };

    return this.saveClient(timedOutClient);
  }

  private saveClient(client: HeartbeatClient): HeartbeatClient {
    this.clients.set(client.clientId, client);

    return client;
  }
}
