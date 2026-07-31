import { randomUUID } from 'node:crypto';

import type { ProfessorPersistence } from '../../persistence/persistence.types.js';

export interface Professor {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
}

export interface RegisterProfessorInput {
  readonly name: string;
  readonly socketId: string;
}

type Clock = () => Date;
type IdFactory = () => string;

export class PresenceManager {
  private readonly professorsBySocketId = new Map<string, Professor>();

  public constructor(
    private readonly clock: Clock = () => new Date(),
    private readonly idFactory: IdFactory = randomUUID,
    private readonly persistence?: ProfessorPersistence,
  ) {}

  public registerProfessor(input: RegisterProfessorInput): Professor {
    const registeredAt = this.clock();
    const professor: Professor = {
      id: this.idFactory(),
      name: input.name,
      socketId: input.socketId,
      onlineSince: registeredAt,
      lastHeartbeat: registeredAt,
    };

    this.professorsBySocketId.set(input.socketId, professor);
    this.persistence?.saveProfessor(professor);
    return professor;
  }

  public removeProfessor(socketId: string): Professor | undefined {
    const professor = this.professorsBySocketId.get(socketId);

    this.professorsBySocketId.delete(socketId);
    if (professor !== undefined) {
      this.persistence?.markOffline(socketId, this.clock());
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

    return expiredProfessors;
  }
}
