import type { Request, Response } from 'express';

import type { StudentPresenceManager } from '@professor-connect/websocket';

export function createOnlineStudentsController(presenceManager: StudentPresenceManager) {
  return function getOnlineStudents(request: Request, response: Response): void {
    const students = presenceManager
      .getOnlineStudents()
      .filter((student) => student.organizationId === request.auth?.organizationId)
      .map((student) => ({
        id: student.id,
        name: student.name,
      }));

    response.json({ count: students.length, students });
  };
}
