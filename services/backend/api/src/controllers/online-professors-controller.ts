import type { Request, Response } from 'express';

import type { PresenceManager } from '@professor-connect/websocket';

export function createOnlineProfessorsController(presenceManager: PresenceManager) {
  return function getOnlineProfessors(request: Request, response: Response): void {
    const professors = presenceManager
      .getAvailableProfessors(request.auth?.organizationId)
      .filter((professor) => professor.organizationId === request.auth?.organizationId)
      .map((professor) => ({
        id: professor.id,
        name: professor.name,
        status: 'available' as const,
        availableSince: (professor.availableSince ?? professor.onlineSince).toISOString(),
        ...(professor.avatarUrl === undefined ? {} : { avatarUrl: professor.avatarUrl }),
      }));

    response.json({ count: professors.length, professors });
  };
}
