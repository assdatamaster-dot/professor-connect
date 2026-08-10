import type { Request, Response } from 'express';

import type {
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

export function createOnlineStudentsController(
  presenceManager: StudentPresenceManager,
  requestManager: SessionRequestManager,
  sessionManager: SessionManager,
) {
  return function getOnlineStudents(request: Request, response: Response): void {
    const students = presenceManager
      .getOnlineStudents()
      .filter((student) => student.organizationId === request.auth?.organizationId)
      .map((student) => {
        const session = sessionManager
          .listActiveSessions()
          .find((item) => item.studentId === student.id);
        const queue = requestManager.getQueueForStudent(student.id);
        return {
          id: student.id,
          name: student.name,
          connectionStatus: 'ONLINE',
          attendanceStatus:
            session !== undefined ? 'IN_ATTENDANCE' : queue !== undefined ? 'WAITING' : 'AVAILABLE',
          onlineSince: student.onlineSince.toISOString(),
          lastHeartbeat: student.lastHeartbeat.toISOString(),
          ...(queue === undefined
            ? {}
            : {
                queuePosition: queue.position,
                waitingSince: queue.queuedAt ?? queue.createdAt,
              }),
          ...(session === undefined
            ? {}
            : { attendanceStartedAt: session.createdAt, sessionId: session.sessionId }),
        };
      });

    response.json({ count: students.length, students });
  };
}
