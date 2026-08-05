import { randomUUID } from 'node:crypto';

import type { ProfessorPersistence } from '../../persistence/persistence.types.js';

export interface Professor {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
  readonly availability: ProfessorAvailability;
  readonly availableSince: Date | undefined;
  readonly avatarUrl?: string;
  readonly organizationId?: string;
}

export type ProfessorAvailability = 'available' | 'unavailable' | 'busy';
export type ProfessorPresenceListener = (professors: readonly Professor[]) => void;

export interface RegisterProfessorInput {
  readonly id?: string;
  readonly name: string;
  readonly socketId: string;
  readonly avatarUrl?: string;
  readonly organizationId?: string;
}

type Clock = () => Date;
type IdFactory = () => string;

export class PresenceManager {
  private readonly professorsBySocketId = new Map<string, Professor>();
  private readonly listeners = new Set<ProfessorPresenceListener>();

  public constructor(
    private readonly clock: Clock = () => new Date(),
    private readonly idFactory: IdFactory = randomUUID,
    private readonly persistence?: ProfessorPersistence,
  ) {}

  public registerProfessor(input: RegisterProfessorInput): Professor {
    const registeredAt = this.clock();
    const professor: Professor = {
      id: input.id ?? this.idFactory(),
      name: input.name,
      socketId: input.socketId,
      onlineSince: registeredAt,
      lastHeartbeat: registeredAt,
      availability: 'available',
      availableSince: registeredAt,
      ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    };

    this.professorsBySocketId.set(input.socketId, professor);
    this.persistence?.saveProfessor(professor);
    this.notifyListeners();
    return professor;
  }

  public removeProfessor(socketId: string): Professor | undefined {
    const professor = this.professorsBySocketId.get(socketId);

    this.professorsBySocketId.delete(socketId);
    if (professor !== undefined) {
      this.persistence?.markOffline(socketId, this.clock());
      this.notifyListeners();
    }
    return professor;
  }

  public updateHeartbeat(socketId: string): Professor | undefined {
    const professor = this.professorsBySocketId.get(socketId);

    if (professor === undefined) {
      return undefined;
    }

    const updatedProfessor = {
      ...professor,
      lastHeartbeat: this.clock(),
    };

    this.professorsBySocketId.set(socketId, updatedProfessor);
    this.persistence?.updateHeartbeat(socketId, updatedProfessor.lastHeartbeat);
    return updatedProfessor;
  }

  public getOnlineProfessors(): readonly Professor[] {
    return [...this.professorsBySocketId.values()];
  }

  public getAvailableProfessors(organizationId?: string): readonly Professor[] {
    return this.getOnlineProfessors().filter(
      (professor) =>
        professor.availability === 'available' &&
        (organizationId === undefined || professor.organizationId === organizationId),
    );
  }

  public setAvailability(socketId: string, availability: ProfessorAvailability): Professor {
    const professor = this.findProfessorBySocketId(socketId);
    if (professor === undefined) {
      throw new Error('Professor não está conectado');
    }
    const availableSince = availability === 'available' ? this.clock() : undefined;
    const updated: Professor = { ...professor, availability, availableSince };
    this.professorsBySocketId.set(socketId, updated);
    this.persistence?.updateAvailability(updated.id, availability, availableSince);
    this.notifyListeners();
    return updated;
  }

  public setAvailabilityByProfessorId(
    professorId: string,
    availability: ProfessorAvailability,
  ): Professor | undefined {
    const professor = this.findProfessorById(professorId);
    return professor === undefined
      ? undefined
      : this.setAvailability(professor.socketId, availability);
  }

  public onChanged(listener: ProfessorPresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public findProfessorById(professorId: string): Professor | undefined {
    return this.getOnlineProfessors().find((professor) => professor.id === professorId);
  }

  public findProfessorBySocketId(socketId: string): Professor | undefined {
    return this.professorsBySocketId.get(socketId);
  }

  public removeProfessorsWithoutHeartbeat(timeoutMs: number): readonly Professor[] {
    const expirationThreshold = this.clock().getTime() - timeoutMs;
    const expiredProfessors = this.getOnlineProfessors().filter(
      (professor) => professor.lastHeartbeat.getTime() < expirationThreshold,
    );

    for (const professor of expiredProfessors) {
      this.professorsBySocketId.delete(professor.socketId);
      this.persistence?.markOffline(professor.socketId, this.clock());
    }

    if (expiredProfessors.length > 0) this.notifyListeners();

    return expiredProfessors;
  }

  private notifyListeners(): void {
    const snapshot = this.getOnlineProfessors();
    for (const listener of this.listeners) listener(snapshot);
  }
}
