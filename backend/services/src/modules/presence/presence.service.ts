import type {
  ClientPresence,
  PresenceRegisterPayload,
  PresenceStatus,
} from '@professor-connect/shared-types';

import type { ConnectionService } from '../connection/connection.service.js';
import type { PresenceManager } from './presence.manager.js';

export class PresenceService {
  public constructor(
    private readonly presenceManager: PresenceManager,
    private readonly connectionService: ConnectionService,
  ) {}

  public registerClient(connectionId: string, payload: PresenceRegisterPayload): ClientPresence {
    this.requireConnection(connectionId);

    return this.presenceManager.registerClient({ connectionId, ...payload });
  }

  public updateStatusByConnection(connectionId: string, status: PresenceStatus): ClientPresence {
    const client = this.requirePresenceByConnection(connectionId);

    return this.presenceManager.updateStatus(client.clientId, status);
  }

  public updateLastSeenByConnection(connectionId: string): ClientPresence | undefined {
    const client = this.presenceManager.findByConnectionId(connectionId);

    return client === undefined ? undefined : this.presenceManager.updateLastSeen(client.clientId);
  }

  public disconnectClient(connectionId: string): ClientPresence | undefined {
    return this.presenceManager.disconnectClient(connectionId);
  }

  public markConnectionLost(connectionId: string): ClientPresence | undefined {
    return this.presenceManager.markConnectionLost(connectionId);
  }

  public recoverClient(clientId: string, connectionId: string): ClientPresence {
    this.requireConnection(connectionId);

    return this.presenceManager.recoverClient(clientId, connectionId);
  }

  public timeoutClient(clientId: string): ClientPresence {
    return this.presenceManager.timeoutClient(clientId);
  }

  public findByConnectionId(connectionId: string): ClientPresence | undefined {
    return this.presenceManager.findByConnectionId(connectionId);
  }

  public findClient(clientId: string): ClientPresence | undefined {
    return this.presenceManager.findClient(clientId);
  }

  public listOnlineClients(): readonly ClientPresence[] {
    return this.presenceManager.listOnlineClients();
  }

  public listAvailableTeachers(): readonly ClientPresence[] {
    return this.presenceManager.listAvailableTeachers();
  }

  public listConnectedStudents(): readonly ClientPresence[] {
    return this.presenceManager.listConnectedStudents();
  }

  private requireConnection(connectionId: string): void {
    if (!this.connectionService.isConnected(connectionId)) {
      throw new Error(`Conexão não registrada: ${connectionId}`);
    }
  }

  private requirePresenceByConnection(connectionId: string): ClientPresence {
    const client = this.findByConnectionId(connectionId);

    if (client === undefined) {
      throw new Error(`Presença não registrada para a conexão: ${connectionId}`);
    }

    return client;
  }
}
