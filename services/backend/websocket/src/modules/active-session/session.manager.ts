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
  SessionParticipantRole,
  SessionRecoveryResult,
} from './session.types.js';
import { SessionRecoveryManager } from './session-recovery.manager.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import { ConnectionHealthMonitor } from './connection-health.monitor.js';

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
  private readonly recoveryWindowMs: number;
  private readonly recoveryManager = new SessionRecoveryManager();
  private readonly healthMonitor = new ConnectionHealthMonitor();

  public constructor(
    private readonly professorPresenceManager = new PresenceManager(),
    private readonly studentPresenceManager = new StudentPresenceManager(),
    options: SessionManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.persistence = options.persistence;
    this.audit = options.audit;
    this.recoveryWindowMs = options.recoveryWindowMs ?? 90_000;
    for (const session of options.initialHistory ?? []) {
      if (session.status === 'active') {
        const recoveringSession: AttendanceSession = {
          ...session,
          connectionState: 'RECOVERING',
          stateUpdatedAt: this.clock().toISOString(),
          recoveryDeadline:
            session.recoveryDeadline ??
            new Date(this.clock().getTime() + this.recoveryWindowMs).toISOString(),
        };
        this.activeSessions.set(session.sessionId, recoveringSession);
        this.participantSocketsBySessionId.set(session.sessionId, {
          teacherSocketId: undefined,
          studentSocketId: undefined,
        });
      } else {
        this.history.set(session.sessionId, session);
      }
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

    if (this.hasActiveSessionForProfessor(request.teacherId)) {
      throw new Error('O professor já possui um atendimento ativo');
    }
    if (
      [...this.activeSessions.values()].some((session) => session.studentId === request.studentId)
    ) {
      throw new Error('O aluno já possui um atendimento ativo');
    }

    const teacherCredentials = this.recoveryManager.issueCredentials();
    const studentCredentials = this.recoveryManager.issueCredentials();
    const now = this.clock().toISOString();
    const session: AttendanceSession = {
      sessionId: this.idFactory(),
      requestId: request.requestId,
      teacherId: request.teacherId,
      teacherName: request.teacherName,
      studentId: request.studentId,
      studentName: request.studentName,
      createdAt: now,
      status: 'active',
      connectionState: 'CONNECTED',
      stateUpdatedAt: now,
      teacherRecoveryTokenHash: teacherCredentials.tokenHash,
      studentRecoveryTokenHash: studentCredentials.tokenHash,
      lastHeartbeatAt: now,
      connectedMilliseconds: 0,
      reconnectingMilliseconds: 0,
      disconnectCount: 0,
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
    return {
      ...delivery,
      teacherRecoveryToken: teacherCredentials.token,
      studentRecoveryToken: studentCredentials.token,
    };
  }

  public findSession(sessionId: string): AttendanceSession | undefined {
    return this.activeSessions.get(sessionId) ?? this.history.get(sessionId);
  }

  public listActiveSessions(): readonly AttendanceSession[] {
    return [...this.activeSessions.values()];
  }

  public hasActiveSessionForProfessor(teacherId: string): boolean {
    return this.listActiveSessions().some((session) => session.teacherId === teacherId);
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

  public endRecoverableSession(
    sessionId: string,
    token: string,
    identity: SocketIdentity | undefined,
  ): SessionDelivery {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) throw new Error(`Sessão ativa não encontrada: ${sessionId}`);
    const role = this.requireParticipantRole(session, identity);
    if (!this.recoveryManager.verifyToken(session, role, token)) {
      throw new Error('Token de recuperação inválido');
    }
    return this.finishSession(session, 'participant-recovery-declined');
  }

  public markParticipantDisconnected(participantSocketId: string): readonly SessionDelivery[] {
    const sessions = this.listActiveSessions().filter((session) => {
      const participantSockets = this.participantSocketsBySessionId.get(session.sessionId);
      return (
        participantSockets?.teacherSocketId === participantSocketId ||
        participantSockets?.studentSocketId === participantSocketId
      );
    });

    return sessions.map((session) => {
      const participantSockets = this.participantSocketsBySessionId.get(session.sessionId);
      if (participantSockets === undefined) return this.createDelivery(session);
      const now = this.clock();
      const updated: AttendanceSession = {
        ...session,
        ...this.healthMonitor.transition(session, 'RECONNECTING', now),
        recoveryDeadline: new Date(now.getTime() + this.recoveryWindowMs).toISOString(),
        disconnectCount: (session.disconnectCount ?? 0) + 1,
      };
      this.activeSessions.set(session.sessionId, updated);
      this.participantSocketsBySessionId.set(session.sessionId, {
        teacherSocketId:
          participantSockets.teacherSocketId === participantSocketId
            ? undefined
            : participantSockets.teacherSocketId,
        studentSocketId:
          participantSockets.studentSocketId === participantSocketId
            ? undefined
            : participantSockets.studentSocketId,
      });
      this.persistence?.saveRecoveryState?.(updated);
      this.audit?.record({
        action: 'session.reconnecting',
        entityType: 'attendance-session',
        entityId: session.sessionId,
        severity: 'warning',
        metadata: {
          disconnectCount: updated.disconnectCount,
          recoveryDeadline: updated.recoveryDeadline,
        },
      });
      return this.createDelivery(updated);
    });
  }

  /** @deprecated A transport loss is recoverable and must not finish the session. */
  public endSessionsForParticipant(participantSocketId: string): readonly SessionDelivery[] {
    return this.markParticipantDisconnected(participantSocketId);
  }

  public recoverSession(
    sessionId: string,
    token: string,
    socketId: string,
    identity: SocketIdentity | undefined,
  ): SessionRecoveryResult {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) throw new Error('Sessão recuperável não encontrada');
    const role = this.requireParticipantRole(session, identity);
    if (!this.recoveryManager.verifyToken(session, role, token)) {
      throw new Error('Token de recuperação inválido');
    }
    if (
      session.recoveryDeadline !== undefined &&
      Date.parse(session.recoveryDeadline) < this.clock().getTime()
    ) {
      throw new Error('Janela de recuperação expirada');
    }
    const credentials = this.recoveryManager.issueCredentials();
    const sockets = this.participantSocketsBySessionId.get(sessionId) ?? {
      teacherSocketId: undefined,
      studentSocketId: undefined,
    };
    const nextSockets = {
      teacherSocketId: role === 'teacher' ? socketId : sockets.teacherSocketId,
      studentSocketId: role === 'student' ? socketId : sockets.studentSocketId,
    };
    const fullyRecovered =
      nextSockets.teacherSocketId !== undefined && nextSockets.studentSocketId !== undefined;
    const now = this.clock();
    const offlineMilliseconds = Math.max(
      0,
      now.getTime() - Date.parse(session.stateUpdatedAt ?? session.createdAt),
    );
    const { recoveryDeadline: _recoveryDeadline, ...sessionWithoutRecoveryDeadline } = session;
    void _recoveryDeadline;
    const updated: AttendanceSession = {
      ...sessionWithoutRecoveryDeadline,
      ...this.healthMonitor.transition(session, fullyRecovered ? 'CONNECTED' : 'RECOVERING', now),
      lastHeartbeatAt: now.toISOString(),
      ...(fullyRecovered || session.recoveryDeadline === undefined
        ? {}
        : { recoveryDeadline: session.recoveryDeadline }),
      ...(role === 'teacher'
        ? { teacherRecoveryTokenHash: credentials.tokenHash }
        : { studentRecoveryTokenHash: credentials.tokenHash }),
    };
    this.activeSessions.set(sessionId, updated);
    this.participantSocketsBySessionId.set(sessionId, nextSockets);
    this.persistence?.saveRecoveryState?.(updated);
    this.professorPresenceManager.setAvailabilityByProfessorId(session.teacherId, 'busy');
    this.audit?.record({
      action: 'session.recovered',
      entityType: 'attendance-session',
      entityId: sessionId,
      actorType: role,
      ...(identity?.profileId === undefined ? {} : { actorId: identity.profileId }),
      metadata: { fullyRecovered, disconnectCount: updated.disconnectCount, offlineMilliseconds },
    });
    return {
      ...this.createDelivery(updated),
      recoveredRole: role,
      recoveryToken: credentials.token,
      fullyRecovered,
    };
  }

  public expireRecovery(sessionId: string): SessionDelivery | undefined {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined || session.recoveryDeadline === undefined) return undefined;
    if (Date.parse(session.recoveryDeadline) > this.clock().getTime()) return undefined;
    this.audit?.record({
      action: 'session.recovery-failed',
      entityType: 'attendance-session',
      entityId: sessionId,
      severity: 'error',
      metadata: { recoveryDeadline: session.recoveryDeadline },
    });
    return this.finishSession(session, 'recovery-timeout');
  }

  public getDelivery(sessionId: string): SessionDelivery | undefined {
    const session = this.activeSessions.get(sessionId);
    return session === undefined ? undefined : this.createDelivery(session);
  }

  public recordHeartbeat(participantSocketId: string): void {
    const now = this.clock().toISOString();
    for (const session of this.activeSessions.values()) {
      const sockets = this.participantSocketsBySessionId.get(session.sessionId);
      if (
        sockets?.teacherSocketId !== participantSocketId &&
        sockets?.studentSocketId !== participantSocketId
      ) {
        continue;
      }
      const updated = { ...session, lastHeartbeatAt: now };
      this.activeSessions.set(session.sessionId, updated);
      this.persistence?.saveConnectionHealth?.(updated);
    }
  }

  private finishSession(session: AttendanceSession, endReason: string): SessionDelivery {
    const endedAt = this.clock();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - Date.parse(session.createdAt)) / 1_000),
    );
    const {
      teacherRecoveryTokenHash,
      studentRecoveryTokenHash,
      recoveryDeadline,
      ...sessionWithoutRecoveryCredentials
    } = session;
    void teacherRecoveryTokenHash;
    void studentRecoveryTokenHash;
    void recoveryDeadline;
    const finishedSession: AttendanceSession = {
      ...sessionWithoutRecoveryCredentials,
      status: 'finished',
      connectionState: 'FINISHED',
      stateUpdatedAt: endedAt.toISOString(),
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

    const sockets = this.participantSocketsBySessionId.get(sessionId);
    if (sockets?.teacherSocketId === senderSocketId) {
      if (sockets.studentSocketId === undefined) {
        throw new Error('Aluno destinatário não está online');
      }
      return { session, recipientSocketId: sockets.studentSocketId, senderRole: 'teacher' };
    }

    if (sockets?.studentSocketId === senderSocketId) {
      if (sockets.teacherSocketId === undefined) {
        throw new Error('Professor destinatário não está online');
      }
      return { session, recipientSocketId: sockets.teacherSocketId, senderRole: 'student' };
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

  private requireParticipantRole(
    session: AttendanceSession,
    identity: SocketIdentity | undefined,
  ): SessionParticipantRole {
    if (identity?.profileId === session.teacherId && identity.roles.includes('TEACHER')) {
      return 'teacher';
    }
    if (identity?.profileId === session.studentId && identity.roles.includes('STUDENT')) {
      return 'student';
    }
    throw new Error('Identidade não pertence à sessão');
  }
}
