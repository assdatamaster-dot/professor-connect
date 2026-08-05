import { randomUUID } from 'node:crypto';

import { PresenceManager } from '../professor-presence/presence.manager.js';
import { StudentPresenceManager } from '../student-presence/student-presence.manager.js';
import type { SessionRequest } from '../session-request/session-request.types.js';
import type {
  AttendanceSession,
  SessionDelivery,
  SessionEndedListener,
  SessionManagerOptions,
  SessionSignalingRoute,
} from './session.types.js';

export class SessionManager {
  private readonly activeSessions = new Map<string, AttendanceSession>();
  private readonly history = new Map<string, AttendanceSession>();
  private readonly sessionIdsByRequestId = new Map<string, string>();
  private readonly participantSocketsBySessionId = new Map<
    string,
    {
      readonly teacherSocketId: string | undefined;
      readonly studentSocketId: string | undefined;
    }
  >();
  private readonly endedListeners = new Set<SessionEndedListener>();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly persistence: SessionManagerOptions['persistence'];
  private readonly audit: SessionManagerOptions['audit'];

  public constructor(
    private readonly professorPresenceManager = new PresenceManager(),
    private readonly studentPresenceManager = new StudentPresenceManager(),
    options: SessionManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.persistence = options.persistence;
    this.audit = options.audit;
    for (const session of options.initialHistory ?? []) {
      this.history.set(session.sessionId, session);
      this.sessionIdsByRequestId.set(session.requestId, session.sessionId);
    }
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

    const delivery = this.createDelivery(session);
    if (delivery.teacherSocketId === undefined || delivery.studentSocketId === undefined) {
      throw new Error('Os dois participantes precisam estar online para criar a sessão');
    }
    this.activeSessions.set(session.sessionId, session);
    this.sessionIdsByRequestId.set(session.requestId, session.sessionId);
    this.participantSocketsBySessionId.set(session.sessionId, {
      teacherSocketId: delivery.teacherSocketId,
      studentSocketId: delivery.studentSocketId,
    });
    this.persistence?.saveSession(session);
    this.professorPresenceManager.setAvailabilityByProfessorId(session.teacherId, 'busy');
    this.audit?.record({
      action: 'session.started',
      entityType: 'attendance-session',
      entityId: session.sessionId,
      metadata: {
        requestId: session.requestId,
        organizationId: this.professorPresenceManager.findProfessorById(session.teacherId)
          ?.organizationId,
      },
    });
    return delivery;
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

  public findSessionByRequestId(requestId: string): AttendanceSession | undefined {
    const sessionId = this.sessionIdsByRequestId.get(requestId);
    return sessionId === undefined ? undefined : this.findSession(sessionId);
  }

  public endSession(sessionId: string, participantSocketId: string): SessionDelivery {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Sessão ativa não encontrada: ${sessionId}`);
    }

    const participantSockets = this.participantSocketsBySessionId.get(sessionId);
    if (
      participantSockets?.teacherSocketId !== participantSocketId &&
      participantSockets?.studentSocketId !== participantSocketId
    ) {
      throw new Error('Somente um participante pode encerrar a sessão');
    }

    return this.finishSession(session, 'participant');
  }

  public endSessionsForParticipant(participantSocketId: string): readonly SessionDelivery[] {
    const sessions = this.listActiveSessions().filter((session) => {
      const participantSockets = this.participantSocketsBySessionId.get(session.sessionId);
      return (
        participantSockets?.teacherSocketId === participantSocketId ||
        participantSockets?.studentSocketId === participantSocketId
      );
    });

    return sessions.map((session) => this.finishSession(session, 'participant-disconnected'));
  }

  private finishSession(session: AttendanceSession, endReason: string): SessionDelivery {
    const endedAt = this.clock();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - Date.parse(session.createdAt)) / 1_000),
    );
    const finishedSession: AttendanceSession = {
      ...session,
      status: 'finished',
      endedAt: endedAt.toISOString(),
      durationSeconds,
      endReason,
    };
    this.activeSessions.delete(session.sessionId);
    this.history.set(session.sessionId, finishedSession);
    const delivery = this.createDelivery(finishedSession);
    this.participantSocketsBySessionId.delete(session.sessionId);
    this.persistence?.saveSession(finishedSession, endReason);
    this.professorPresenceManager.setAvailabilityByProfessorId(session.teacherId, 'available');
    this.audit?.record({
      action: 'session.finished',
      entityType: 'attendance-session',
      entityId: session.sessionId,
      metadata: {
        endReason,
        durationSeconds,
        organizationId: this.professorPresenceManager.findProfessorById(session.teacherId)
          ?.organizationId,
      },
    });
    for (const listener of this.endedListeners) {
      listener(delivery);
    }
    return delivery;
  }

  public resolveSignalingRoute(sessionId: string, senderSocketId: string): SessionSignalingRoute {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Sessão ativa não encontrada: ${sessionId}`);
    }

    const teacher = this.professorPresenceManager.findProfessorBySocketId(senderSocketId);
    if (teacher?.id === session.teacherId) {
      const student = this.studentPresenceManager.findStudentById(session.studentId);
      if (student === undefined) {
        throw new Error('Aluno destinatário não está online');
      }
      return { session, recipientSocketId: student.socketId, senderRole: 'teacher' };
    }

    const student = this.studentPresenceManager.findStudentBySocketId(senderSocketId);
    if (student?.id === session.studentId) {
      const recipientTeacher = this.professorPresenceManager.findProfessorById(session.teacherId);
      if (recipientTeacher === undefined) {
        throw new Error('Professor destinatário não está online');
      }
      return { session, recipientSocketId: recipientTeacher.socketId, senderRole: 'student' };
    }

    throw new Error('Remetente não pertence à sessão');
  }

  public onSessionEnded(listener: SessionEndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  public markFeatureUsed(
    sessionId: string,
    feature: 'screen-share' | 'remote-control' | 'file-transfer',
  ): void {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`Sessão ativa não encontrada: ${sessionId}`);
    }
    this.persistence?.markFeatureUsed(sessionId, feature);
  }

  private createDelivery(session: AttendanceSession): SessionDelivery {
    const participantSockets = this.participantSocketsBySessionId.get(session.sessionId);
    return {
      session,
      teacherSocketId:
        participantSockets?.teacherSocketId ??
        this.professorPresenceManager.findProfessorById(session.teacherId)?.socketId,
      studentSocketId:
        participantSockets?.studentSocketId ??
        this.studentPresenceManager.findStudentById(session.studentId)?.socketId,
    };
  }
}
