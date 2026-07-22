import { randomUUID } from 'node:crypto';

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
    return professor;
  }

  public removeProfessor(socketId: string): Professor | undefined {
    const professor = this.professorsBySocketId.get(socketId);

    this.professorsBySocketId.delete(socketId);
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
    }

    return expiredProfessors;
  }
}
