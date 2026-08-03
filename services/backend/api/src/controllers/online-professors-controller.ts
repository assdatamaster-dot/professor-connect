import type { Request, Response } from 'express';

import type { PresenceManager } from '@professor-connect/websocket';

export function createOnlineProfessorsController(presenceManager: PresenceManager) {
  return function getOnlineProfessors(request: Request, response: Response): void {
    const professors = presenceManager
      .getOnlineProfessors()
      .filter((professor) => professor.organizationId === request.auth?.organizationId)
      .map((professor) => ({
        id: professor.id,
        name: professor.name,
      }));

    response.json({ count: professors.length, professors });
  };
}
