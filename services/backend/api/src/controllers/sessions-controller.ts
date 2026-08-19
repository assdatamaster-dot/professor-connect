import type { Request, Response } from 'express';

import type { SessionManager, SessionRequestManager } from '@professor-connect/websocket';

export function createPendingSessionsController(manager: SessionRequestManager) {
  return function getPendingSessions(request: Request, response: Response): void {
    response.json(
      manager.listPendingRequests().filter((session) => isVisibleToIdentity(session, request)),
    );
  };
}

export function createAttendanceQueueController(manager: SessionRequestManager) {
  return function getAttendanceQueue(request: Request, response: Response): void {
    const identity = request.auth;
    if (identity?.profileId === undefined) {
      response.status(403).json({ code: 'profile_required', message: 'Perfil obrigatório' });
      return;
    }
    if (identity.roles.includes('TEACHER')) {
      const queue = manager.getQueueForTeacher(identity.profileId);
      response.json({
        totalWaiting: queue.length,
        requests: queue.map((entry) => ({
          requestId: entry.requestId,
          student: { id: entry.studentId, name: entry.studentName },
          status: 'WAITING',
          position: entry.position,
          requestedAt: entry.createdAt,
          queuedAt: entry.queuedAt ?? null,
          waitingSeconds: elapsedSeconds(entry.createdAt),
        })),
      });
      return;
    }
    if (identity.roles.includes('STUDENT')) {
      const entry = manager.getQueueForStudent(identity.profileId);
      response.json(
        entry === undefined
          ? { request: null }
          : {
              request: {
                requestId: entry.requestId,
                teacher: { id: entry.teacherId, name: entry.teacherName },
                status: 'WAITING',
                position: entry.position,
                studentsAhead: entry.studentsAhead,
                totalWaiting: entry.totalWaiting,
                estimatedWaitMinutes: entry.estimatedWaitMinutes,
                requestedAt: entry.createdAt,
                queuedAt: entry.queuedAt ?? null,
                waitingSeconds: elapsedSeconds(entry.createdAt),
                teacherOnline: entry.teacherOnline,
                nextExpected: entry.mode === 'direct' ? 'TEACHER_RESPONSE' : 'AUTOMATIC_CALL',
              },
            },
      );
      return;
    }
    response.status(403).json({ code: 'forbidden', message: 'Operação não autorizada' });
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

function elapsedSeconds(timestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1_000));
}
