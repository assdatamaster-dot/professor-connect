import { ClientRole, PresenceStatus, type ClientPresence } from '@professor-connect/shared-types';

import type { PresenceClock, PresenceRegistration } from './presence.types.js';

export class PresenceManager {
  private readonly clients = new Map<string, ClientPresence>();
  private readonly clientIdsByConnection = new Map<string, string>();

  public constructor(private readonly clock: PresenceClock = () => new Date()) {}

  public registerClient(registration: PresenceRegistration): ClientPresence {
    const existingClient = this.clients.get(registration.clientId);
    const clientForConnection = this.findByConnectionId(registration.connectionId);

    if (
      clientForConnection !== undefined &&
      clientForConnection.clientId !== registration.clientId
    ) {
      throw new Error(`Conexão já associada a outro cliente: ${registration.connectionId}`);
    }

    if (
      existingClient !== undefined &&
      existingClient.connectionId !== registration.connectionId &&
      existingClient.status !== PresenceStatus.OFFLINE
    ) {
      throw new Error(`Cliente já possui uma conexão ativa: ${registration.clientId}`);
    }

    if (existingClient !== undefined) {
      this.clientIdsByConnection.delete(existingClient.connectionId);
    }

    const client: ClientPresence = {
      ...registration,
      status: PresenceStatus.ONLINE,
      lastSeen: this.clock().toISOString(),
    };

    this.clients.set(client.clientId, client);
    this.clientIdsByConnection.set(client.connectionId, client.clientId);

    return client;
  }

  public updateStatus(clientId: string, status: PresenceStatus): ClientPresence {
    const client = this.requireClient(clientId);
    const updatedClient: ClientPresence = {
      ...client,
      status,
      lastSeen: this.clock().toISOString(),
    };

    this.clients.set(clientId, updatedClient);

    return updatedClient;
  }

  public updateLastSeen(clientId: string): ClientPresence {
    const client = this.requireClient(clientId);
    const updatedClient: ClientPresence = {
      ...client,
      lastSeen: this.clock().toISOString(),
    };

    this.clients.set(clientId, updatedClient);

    return updatedClient;
  }

  public disconnectClient(connectionId: string): ClientPresence | undefined {
    const client = this.findByConnectionId(connectionId);

    if (client === undefined) {
      return undefined;
    }

    this.clientIdsByConnection.delete(connectionId);

    return this.updateStatus(client.clientId, PresenceStatus.OFFLINE);
  }

  public markConnectionLost(connectionId: string): ClientPresence | undefined {
    const client = this.findByConnectionId(connectionId);

    if (client === undefined) {
      return undefined;
    }

    this.clientIdsByConnection.delete(connectionId);

    return this.updateLastSeen(client.clientId);
  }

  public recoverClient(clientId: string, connectionId: string): ClientPresence {
    const client = this.requireClient(clientId);

    if (client.status === PresenceStatus.OFFLINE) {
      throw new Error(`Presença expirada não pode ser recuperada: ${clientId}`);
    }

    this.clientIdsByConnection.delete(client.connectionId);

    const recoveredClient: ClientPresence = {
      ...client,
      connectionId,
      lastSeen: this.clock().toISOString(),
    };

    this.clients.set(clientId, recoveredClient);
    this.clientIdsByConnection.set(connectionId, clientId);

    return recoveredClient;
  }

  public timeoutClient(clientId: string): ClientPresence {
    const client = this.requireClient(clientId);

    this.clientIdsByConnection.delete(client.connectionId);

    return this.updateStatus(clientId, PresenceStatus.OFFLINE);
  }

  public findClient(clientId: string): ClientPresence | undefined {
    return this.clients.get(clientId);
  }

  public findByConnectionId(connectionId: string): ClientPresence | undefined {
    const clientId = this.clientIdsByConnection.get(connectionId);

    return clientId === undefined ? undefined : this.findClient(clientId);
  }

  public listOnlineClients(): readonly ClientPresence[] {
    return [...this.clients.values()].filter((client) => client.status !== PresenceStatus.OFFLINE);
  }

  public listAvailableTeachers(): readonly ClientPresence[] {
    return this.listOnlineClients().filter(
      (client) => client.role === ClientRole.TEACHER && client.status === PresenceStatus.AVAILABLE,
    );
  }

  public listConnectedStudents(): readonly ClientPresence[] {
    return this.listOnlineClients().filter((client) => client.role === ClientRole.STUDENT);
  }

  private requireClient(clientId: string): ClientPresence {
    const client = this.findClient(clientId);

    if (client === undefined) {
      throw new Error(`Presença não registrada para o cliente: ${clientId}`);
    }

    return client;
  }
}
