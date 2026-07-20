import type { ConnectionManager } from './connection.manager.js';
import type { ConnectedClient } from './connection.types.js';

export class ConnectionService {
  public constructor(private readonly connectionManager: ConnectionManager) {}

  public registerClient(clientId: string): ConnectedClient {
    return this.connectionManager.registerClient(clientId);
  }

  public removeClient(clientId: string): boolean {
    return this.connectionManager.removeClient(clientId);
  }

  public findClient(clientId: string): ConnectedClient | undefined {
    return this.connectionManager.findClient(clientId);
  }

  public listClients(): readonly ConnectedClient[] {
    return this.connectionManager.listClients();
  }

  public isConnected(clientId: string): boolean {
    return this.connectionManager.hasClient(clientId);
  }

  public recordHeartbeat(clientId: string): ConnectedClient | undefined {
    return this.connectionManager.recordHeartbeat(clientId);
  }

  public markInactive(clientId: string): ConnectedClient | undefined {
    return this.connectionManager.markInactive(clientId);
  }

  public markLost(clientId: string): ConnectedClient | undefined {
    return this.connectionManager.markLost(clientId);
  }

  public recoverConnection(
    previousConnectionId: string,
    connectionId: string,
  ): ConnectedClient | undefined {
    return this.connectionManager.recoverConnection(previousConnectionId, connectionId);
  }

  public timeoutConnection(clientId: string): ConnectedClient | undefined {
    return this.connectionManager.timeoutConnection(clientId);
  }
}
