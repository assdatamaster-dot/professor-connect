export interface OnlineStudent {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
}

export interface RegisterStudentInput {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
}

type Clock = () => Date;

export class StudentPresenceManager {
  private readonly studentsBySocketId = new Map<string, OnlineStudent>();

  public constructor(private readonly clock: Clock = () => new Date()) {}

  public registerStudent(input: RegisterStudentInput): OnlineStudent {
    const registeredAt = this.clock();
    const student: OnlineStudent = {
      id: input.id,
      name: input.name,
      socketId: input.socketId,
      onlineSince: registeredAt,
      lastHeartbeat: registeredAt,
    };

    this.studentsBySocketId.set(input.socketId, student);
    return student;
  }

  public removeStudent(socketId: string): OnlineStudent | undefined {
    const student = this.studentsBySocketId.get(socketId);

    this.studentsBySocketId.delete(socketId);
    return student;
  }

  public updateHeartbeat(socketId: string): OnlineStudent | undefined {
    const student = this.studentsBySocketId.get(socketId);

    if (student === undefined) {
      return undefined;
    }

    const updatedStudent = {
      ...student,
      lastHeartbeat: this.clock(),
    };

    this.studentsBySocketId.set(socketId, updatedStudent);
    return updatedStudent;
  }

  public getOnlineStudents(): readonly OnlineStudent[] {
    return [...this.studentsBySocketId.values()];
  }

  public findStudentById(studentId: string): OnlineStudent | undefined {
    return this.getOnlineStudents().find((student) => student.id === studentId);
  }

  public findStudentBySocketId(socketId: string): OnlineStudent | undefined {
    return this.studentsBySocketId.get(socketId);
  }

  public removeStudentsWithoutHeartbeat(timeoutMs: number): readonly OnlineStudent[] {
    const expirationThreshold = this.clock().getTime() - timeoutMs;
    const expiredStudents = this.getOnlineStudents().filter(
      (student) => student.lastHeartbeat.getTime() < expirationThreshold,
    );

    for (const student of expiredStudents) {
      this.studentsBySocketId.delete(student.socketId);
    }

    return expiredStudents;
  }
}
