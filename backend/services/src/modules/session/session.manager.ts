import { randomUUID } from 'node:crypto';

import { SessionStatus, type Session } from '@professor-connect/shared-types';

import type { SessionStore } from './session.store.js';
import type { SessionClock, SessionIdFactory } from './session.types.js';

const REQUIRED_CLIENTS_FOR_ACTIVE_SESSION = 2;

export class SessionManager {
  public constructor(
    private readonly sessionStore: SessionStore,
    private readonly idFactory: SessionIdFactory = randomUUID,
    private readonly clock: SessionClock = () => new Date(),
  ) {}

  public createSession(): Session {
    const timestamp = this.clock().toISOString();
    const session: Session = {
      id: this.idFactory(),
      clientIds: [],
      status: SessionStatus.WAITING,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.sessionStore.createSession(session);
  }

  public findSession(sessionId: string): Session | undefined {
    return this.sessionStore.findSession(sessionId);
  }

  public listSessions(): readonly Session[] {
    return this.sessionStore.listSessions();
  }

  public addClient(sessionId: string, clientId: string): Session {
    const session = this.requireOpenSession(sessionId);

    if (session.clientIds.includes(clientId)) {
      return session;
    }

    const clientIds = [...session.clientIds, clientId];

    return this.sessionStore.updateSession({
      ...session,
      clientIds,
      status: this.resolveOpenStatus(clientIds),
      updatedAt: this.clock().toISOString(),
    });
  }

  public removeClient(sessionId: string, clientId: string): Session {
    const session = this.requireOpenSession(sessionId);
    const clientIds = session.clientIds.filter(
      (registeredClientId) => registeredClientId !== clientId,
    );

    return this.sessionStore.updateSession({
      ...session,
      clientIds,
      status: this.resolveOpenStatus(clientIds),
      updatedAt: this.clock().toISOString(),
    });
  }

  public finishAndRemoveSession(sessionId: string): Session {
    const finishedSession = this.sessionStore.finishSession(sessionId, this.clock().toISOString());

    this.sessionStore.deleteSession(sessionId);

    return finishedSession;
  }

  public replaceClientConnection(
    previousConnectionId: string,
    connectionId: string,
  ): readonly Session[] {
    return this.listSessions()
      .filter((session) => session.clientIds.includes(previousConnectionId))
      .map((session) => {
        const clientIds = session.clientIds.map((clientId) =>
          clientId === previousConnectionId ? connectionId : clientId,
        );
        const uniqueClientIds = [...new Set(clientIds)];

        return this.sessionStore.updateSession({
          ...session,
          clientIds: uniqueClientIds,
          status: this.resolveOpenStatus(uniqueClientIds),
          updatedAt: this.clock().toISOString(),
        });
      });
  }

  private requireOpenSession(sessionId: string): Session {
    const session = this.findSession(sessionId);

    if (session === undefined) {
      throw new Error(`Sessão não encontrada: ${sessionId}`);
    }

    if (session.status === SessionStatus.FINISHED) {
      throw new Error(`Sessão encerrada: ${sessionId}`);
    }

    return session;
  }

  private resolveOpenStatus(clientIds: readonly string[]): SessionStatus {
    return clientIds.length >= REQUIRED_CLIENTS_FOR_ACTIVE_SESSION
      ? SessionStatus.ACTIVE
      : SessionStatus.WAITING;
  }
}
