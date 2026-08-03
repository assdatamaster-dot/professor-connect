import type { Request, Response } from 'express';

import type { SessionManager, SessionRequestManager } from '@professor-connect/websocket';

export function createPendingSessionsController(manager: SessionRequestManager) {
  return function getPendingSessions(request: Request, response: Response): void {
    response.json(
      manager.listPendingRequests().filter((session) => isVisibleToIdentity(session, request)),
    );
  };
}

export function createSessionHistoryController(manager: SessionRequestManager) {
  return function getSessionHistory(request: Request, response: Response): void {
    response.json(manager.listHistory().filter((session) => isVisibleToIdentity(session, request)));
  };
}

export function createActiveSessionsController(manager: SessionManager) {
  return function getActiveSessions(request: Request, response: Response): void {
    response.json(
      manager
        .listActiveSessions()
        .filter((session) => isVisibleToIdentity(session, request))
        .map((session) => ({
          sessionId: session.sessionId,
          teacherName: session.teacherName,
          studentName: session.studentName,
          createdAt: session.createdAt,
          status: session.status,
        })),
    );
  };
}

export function createSessionDetailsController(manager: SessionManager) {
  return function getSessionDetails(request: Request, response: Response): void {
    const sessionId = request.params.sessionId;
    const session = typeof sessionId === 'string' ? manager.findSession(sessionId) : undefined;

    if (session === undefined || !isVisibleToIdentity(session, request)) {
      response.status(404).json({ message: 'Sessão não encontrada' });
      return;
    }
    response.json(session);
  };
}

function isVisibleToIdentity(
  session: { readonly teacherId: string; readonly studentId: string },
  request: Request,
): boolean {
  const identity = request.auth;
  return (
    identity?.roles.includes('ADMIN') === true ||
    (identity?.roles.includes('TEACHER') === true && identity.profileId === session.teacherId) ||
    (identity?.roles.includes('STUDENT') === true && identity.profileId === session.studentId)
  );
}
