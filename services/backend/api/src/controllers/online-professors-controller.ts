import type { Request, Response } from 'express';

import { calculateProfessorAvailability, type PresenceManager } from '@professor-connect/websocket';

export function createOnlineProfessorsController(presenceManager: PresenceManager) {
  return function getOnlineProfessors(request: Request, response: Response): void {
    const onlineProfessors = presenceManager.getOnlineProfessors();
    const professors = onlineProfessors
      .filter(
        (professor) =>
          professor.organizationId === request.auth?.organizationId &&
          professor.availability !== 'unavailable',
      )
      .map((professor) => ({
        id: professor.id,
        name: professor.name,
        status: professor.availability === 'busy' ? ('busy' as const) : ('available' as const),
        availableSince: (professor.availableSince ?? professor.onlineSince).toISOString(),
        ...(professor.avatarUrl === undefined ? {} : { avatarUrl: professor.avatarUrl }),
      }));

    response.json({
      count: professors.length,
      professors,
      availability: calculateProfessorAvailability(onlineProfessors, request.auth?.organizationId),
    });
  };
}
