import { SessionStatus, type Session } from '@professor-connect/shared-types';

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  public createSession(session: Session): Session {
    if (this.sessions.has(session.id)) {
      throw new Error(`Sessão já existente: ${session.id}`);
    }

    this.sessions.set(session.id, session);

    return session;
  }

  public findSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public updateSession(session: Session): Session {
    if (!this.sessions.has(session.id)) {
      throw new Error(`Sessão não encontrada: ${session.id}`);
    }

    this.sessions.set(session.id, session);

    return session;
  }

  public listSessions(): readonly Session[] {
    return [...this.sessions.values()];
  }

  public finishSession(sessionId: string, updatedAt: string): Session {
    const session = this.requireSession(sessionId);
    const finishedSession: Session = {
      ...session,
      status: SessionStatus.FINISHED,
      updatedAt,
    };

    return this.updateSession(finishedSession);
  }

  public deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private requireSession(sessionId: string): Session {
    const session = this.findSession(sessionId);

    if (session === undefined) {
      throw new Error(`Sessão não encontrada: ${sessionId}`);
    }

    return session;
  }
}
