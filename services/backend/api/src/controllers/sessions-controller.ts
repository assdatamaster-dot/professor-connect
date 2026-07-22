import type { Request, Response } from 'express';

import type { SessionManager, SessionRequestManager } from '@professor-connect/websocket';

export function createPendingSessionsController(manager: SessionRequestManager) {
  return function getPendingSessions(_request: Request, response: Response): void {
    response.json(manager.listPendingRequests());
  };
}

export function createSessionHistoryController(manager: SessionRequestManager) {
  return function getSessionHistory(_request: Request, response: Response): void {
    response.json(manager.listHistory());
  };
}

export function createActiveSessionsController(manager: SessionManager) {
  return function getActiveSessions(_request: Request, response: Response): void {
    response.json(
      manager.listActiveSessions().map((session) => ({
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

    if (session === undefined) {
      response.status(404).json({ message: 'Sessão não encontrada' });
      return;
    }
    response.json(session);
  };
}
