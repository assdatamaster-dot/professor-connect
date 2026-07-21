import type { Session } from '@professor-connect/protocol';

import type { ConnectionService } from '../connection/connection.service.js';
import type { SessionManager } from './session.manager.js';
import type { ClientSessionChange } from './session.types.js';

export class SessionService {
  public constructor(
    private readonly sessionManager: SessionManager,
    private readonly connectionService: ConnectionService,
  ) {}

  public createSession(): Session {
    return this.sessionManager.createSession();
  }

  public findSession(sessionId: string): Session | undefined {
    return this.sessionManager.findSession(sessionId);
  }

  public listSessions(): readonly Session[] {
    return this.sessionManager.listSessions();
  }

  public joinSession(sessionId: string, clientId: string): Session {
    this.requireConnectedClient(clientId);

    return this.sessionManager.addClient(sessionId, clientId);
  }

  public leaveSession(sessionId: string, clientId: string): Session {
    return this.sessionManager.removeClient(sessionId, clientId);
  }

  public leaveAllSessions(clientId: string): readonly ClientSessionChange[] {
    return this.listSessions()
      .filter((session) => session.clientIds.includes(clientId))
      .map((session) => ({
        clientId,
        session: this.sessionManager.removeClient(session.id, clientId),
      }));
  }

  public closeSession(sessionId: string): Session {
    return this.sessionManager.finishAndRemoveSession(sessionId);
  }

  public replaceClientConnection(
    previousConnectionId: string,
    connectionId: string,
  ): readonly Session[] {
    this.requireConnectedClient(connectionId);

    return this.sessionManager.replaceClientConnection(previousConnectionId, connectionId);
  }

  private requireConnectedClient(clientId: string): void {
    if (!this.connectionService.isConnected(clientId)) {
      throw new Error(`Cliente não conectado: ${clientId}`);
    }
  }
}
