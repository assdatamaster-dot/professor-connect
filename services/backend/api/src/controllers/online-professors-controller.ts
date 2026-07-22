import type { Request, Response } from 'express';

import type { PresenceManager } from '@professor-connect/websocket';

export function createOnlineProfessorsController(presenceManager: PresenceManager) {
  return function getOnlineProfessors(_request: Request, response: Response): void {
    const professors = presenceManager.getOnlineProfessors().map((professor) => ({
      id: professor.id,
      name: professor.name,
    }));

    response.json({ count: professors.length, professors });
  };
}
