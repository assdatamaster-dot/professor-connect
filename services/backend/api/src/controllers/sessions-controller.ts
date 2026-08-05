import type { Request, Response } from 'express';

import type { SessionManager, SessionRequestManager } from '@professor-connect/websocket';

export function createPendingSessionsController(manager: SessionRequestManager) {
  return function getPendingSessions(request: Request, response: Response): void {
    response.json(
      manager.listPendingRequests().filter((session) => isVisibleToIdentity(session, request)),
    );
  };
}

export function createSessionHistoryController(
  requestManager: SessionRequestManager,
  sessionManager: SessionManager,
) {
  return function getSessionHistory(request: Request, response: Response): void {
    response.json(
      requestManager
        .listHistory()
        .filter((item) => isVisibleToIdentity(item, request))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((item) => {
          const session = sessionManager.findSessionByRequestId(item.requestId);
          return {
            requestId: item.requestId,
            sessionId: session?.sessionId ?? null,
            professor: { id: item.teacherId, name: item.teacherName },
            student: { id: item.studentId, name: item.studentName },
            requestedAt: item.createdAt,
            respondedAt: item.respondedAt ?? null,
            startedAt: session?.createdAt ?? null,
            endedAt: session?.endedAt ?? null,
            durationSeconds: session?.durationSeconds ?? null,
            status:
              session?.status === 'active'
                ? 'IN_PROGRESS'
                : session?.status === 'finished'
                  ? 'FINALIZED'
                  : item.status.toUpperCase(),
            endReason: session?.endReason ?? null,
          };
        }),
    );
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
