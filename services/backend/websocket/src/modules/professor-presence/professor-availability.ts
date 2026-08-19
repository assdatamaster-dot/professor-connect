import type { Professor } from './presence.manager.js';

export type ProfessorAvailabilityStatus = 'OFFLINE' | 'BUSY' | 'AVAILABLE';

export interface ProfessorAvailabilitySnapshot {
  readonly status: ProfessorAvailabilityStatus;
  readonly online: number;
  readonly available: number;
  readonly busy: number;
  readonly queueEnabled: boolean;
}

export function calculateProfessorAvailability(
  professors: readonly Professor[],
  organizationId?: string,
): ProfessorAvailabilitySnapshot {
  const onlineProfessors = professors.filter(
    (professor) =>
      professor.availability !== 'unavailable' &&
      (organizationId === undefined || professor.organizationId === organizationId),
  );
  const available = onlineProfessors.filter(
    (professor) => professor.availability === 'available',
  ).length;
  const busy = onlineProfessors.filter((professor) => professor.availability === 'busy').length;
  const online = onlineProfessors.length;

  return {
    status: online === 0 ? 'OFFLINE' : available === 0 ? 'BUSY' : 'AVAILABLE',
    online,
    available,
    busy,
    queueEnabled: online > 0,
  };
}
