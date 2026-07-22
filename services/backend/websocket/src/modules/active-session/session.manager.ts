import { randomUUID } from 'node:crypto';

import { PresenceManager } from '../professor-presence/presence.manager.js';
import { StudentPresenceManager } from '../student-presence/student-presence.manager.js';
import type { SessionRequest } from '../session-request/session-request.types.js';
import type { AttendanceSession, SessionDelivery, SessionManagerOptions } from './session.types.js';

export class SessionManager {
  private readonly activeSessions = new Map<string, AttendanceSession>();
  private readonly history = new Map<string, AttendanceSession>();
  private readonly sessionIdsByRequestId = new Map<string, string>();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  public constructor(
    private readonly professorPresenceManager = new PresenceManager(),
    private readonly studentPresenceManager = new StudentPresenceManager(),
    options: SessionManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  public createSession(request: SessionRequest): SessionDelivery {
    if (request.status !== 'accepted') {
      throw new Error('Somente uma solicitação aceita pode criar uma sessão');
    }
    if (this.sessionIdsByRequestId.has(request.requestId)) {
      throw new Error(`Já existe uma sessão para a solicitação: ${request.requestId}`);
    }

    const session: AttendanceSession = {
      sessionId: this.idFactory(),
      requestId: request.requestId,
      teacherId: request.teacherId,
      teacherName: request.teacherName,
      studentId: request.studentId,
      studentName: request.studentName,
      createdAt: this.clock().toISOString(),
      status: 'active',
    };

    this.activeSessions.set(session.sessionId, session);
    this.sessionIdsByRequestId.set(session.requestId, session.sessionId);
    return this.createDelivery(session);
  }

  public findSession(sessionId: string): AttendanceSession | undefined {
    return this.activeSessions.get(sessionId) ?? this.history.get(sessionId);
  }

  public listActiveSessions(): readonly AttendanceSession[] {
    return [...this.activeSessions.values()];
  }

  public listHistory(): readonly AttendanceSession[] {
    return [...this.history.values()];
  }

  public endSession(sessionId: string, participantSocketId: string): SessionDelivery {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Sessão ativa não encontrada: ${sessionId}`);
    }

    const teacher = this.professorPresenceManager.findProfessorBySocketId(participantSocketId);
    const student = this.studentPresenceManager.findStudentBySocketId(participantSocketId);
    if (teacher?.id !== session.teacherId && student?.id !== session.studentId) {
      throw new Error('Somente um participante pode encerrar a sessão');
    }

    const finishedSession: AttendanceSession = { ...session, status: 'finished' };
    this.activeSessions.delete(sessionId);
    this.history.set(sessionId, finishedSession);
    return this.createDelivery(finishedSession);
  }

  private createDelivery(session: AttendanceSession): SessionDelivery {
    return {
      session,
      teacherSocketId: this.professorPresenceManager.findProfessorById(session.teacherId)?.socketId,
      studentSocketId: this.studentPresenceManager.findStudentById(session.studentId)?.socketId,
    };
  }
}
