export interface OnlineStudent {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
  readonly connectionStatus: 'online' | 'reconnecting';
  readonly organizationId?: string;
}

export interface RegisterStudentInput {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly organizationId?: string;
}

type Clock = () => Date;
export type StudentPresenceListener = (students: readonly OnlineStudent[]) => void;

export class StudentPresenceManager {
  private readonly studentsBySocketId = new Map<string, OnlineStudent>();
  private readonly listeners = new Set<StudentPresenceListener>();

  public constructor(
    private readonly clock: Clock = () => new Date(),
    private readonly persistence?: StudentPersistence,
  ) {}

  public registerStudent(input: RegisterStudentInput): OnlineStudent {
    const previous = this.findTrackedStudentById(input.id);
    if (previous !== undefined && previous.socketId !== input.socketId) {
      this.studentsBySocketId.delete(previous.socketId);
      this.persistence?.markOffline(previous.socketId, this.clock());
    }
    const registeredAt = this.clock();
    const student: OnlineStudent = {
      id: input.id,
      name: input.name,
      socketId: input.socketId,
      onlineSince: registeredAt,
      lastHeartbeat: registeredAt,
      connectionStatus: 'online',
      ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    };

    this.studentsBySocketId.set(input.socketId, student);
    this.persistence?.saveStudent(student);
    this.notifyListeners();
    return student;
  }

  public removeStudent(socketId: string): OnlineStudent | undefined {
    const student = this.studentsBySocketId.get(socketId);

    this.studentsBySocketId.delete(socketId);
    if (student !== undefined) {
      this.persistence?.markOffline(socketId, this.clock());
      this.notifyListeners();
    }
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
      connectionStatus: 'online' as const,
    };

    this.studentsBySocketId.set(socketId, updatedStudent);
    this.persistence?.updateHeartbeat(socketId, updatedStudent.lastHeartbeat);
    if (student.connectionStatus === 'reconnecting') this.notifyListeners();
    return updatedStudent;
  }

  public getOnlineStudents(): readonly OnlineStudent[] {
    return this.getTrackedStudents().filter((student) => student.connectionStatus === 'online');
  }

  public getTrackedStudents(): readonly OnlineStudent[] {
    return [...this.studentsBySocketId.values()];
  }

  public findStudentById(studentId: string): OnlineStudent | undefined {
    return this.getOnlineStudents().find((student) => student.id === studentId);
  }

  public findStudentBySocketId(socketId: string): OnlineStudent | undefined {
    return this.studentsBySocketId.get(socketId);
  }

  public markReconnecting(socketId: string): OnlineStudent | undefined {
    const student = this.studentsBySocketId.get(socketId);
    if (student === undefined || student.connectionStatus === 'reconnecting') return student;
    const reconnecting = { ...student, connectionStatus: 'reconnecting' as const };
    this.studentsBySocketId.set(socketId, reconnecting);
    this.notifyListeners();
    return reconnecting;
  }

  public onChanged(listener: StudentPresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public removeStudentsWithoutHeartbeat(timeoutMs: number): readonly OnlineStudent[] {
    const expirationThreshold = this.clock().getTime() - timeoutMs;
    const expiredStudents = this.getTrackedStudents().filter(
      (student) => student.lastHeartbeat.getTime() < expirationThreshold,
    );

    for (const student of expiredStudents) {
      this.studentsBySocketId.delete(student.socketId);
      this.persistence?.markOffline(student.socketId, this.clock());
    }

    if (expiredStudents.length > 0) this.notifyListeners();

    return expiredStudents;
  }

  private notifyListeners(): void {
    const snapshot = this.getTrackedStudents();
    for (const listener of this.listeners) listener(snapshot);
  }

  private findTrackedStudentById(studentId: string): OnlineStudent | undefined {
    return this.getTrackedStudents().find((student) => student.id === studentId);
  }
}
import type { StudentPersistence } from '../../persistence/persistence.types.js';
