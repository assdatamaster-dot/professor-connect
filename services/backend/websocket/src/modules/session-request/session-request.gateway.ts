import type { Server, Socket } from 'socket.io';

import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SessionGateway } from '../active-session/session.gateway.js';
import type { SessionManager } from '../active-session/session.manager.js';
import type { SessionRequestManager } from './session-request.manager.js';
import type { SessionQueueEntry, SessionRequestDelivery } from './session-request.types.js';

export const SESSION_REQUEST_EVENTS = {
  REQUEST: 'request:session',
  CREATED: 'session:pending',
  REQUESTED: 'session:requested',
  ACCEPT: 'session:accept',
  ACCEPTED: 'session:accepted',
  REJECT: 'session:reject',
  REJECTED: 'session:rejected',
  CANCEL: 'session:cancel',
  CANCELLED: 'session:cancelled',
  TIMEOUT: 'session:timeout',
  QUEUE_GET: 'session:queue:get',
  QUEUE_UPDATED: 'session:queue:updated',
  QUEUE_CHANGED: 'session:queue:changed',
  QUEUE_CLEARED: 'session:queue:cleared',
} as const;

export interface RequestSessionPayload {
  readonly teacherId: string;
}

export interface SessionRequestReferencePayload {
  readonly requestId: string;
}

export interface SessionRequestedPayload {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly position: number;
  readonly mode: 'direct' | 'queued';
}

export interface SessionResponsePayload {
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
}

export interface StudentQueuePayload {
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly position: number;
  readonly studentsAhead: number;
  readonly totalWaiting: number;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly mode: 'direct' | 'queued';
  readonly teacherOnline: boolean;
}

export interface TeacherQueuePayload {
  readonly teacherId: string;
  readonly totalWaiting: number;
  readonly requests: readonly SessionRequestedPayload[];
}

interface SessionRequestClientEvents {
  'professor:online': (payload: { readonly name: string }) => void;
  'student:register': (payload: { readonly id: string; readonly name: string }) => void;
  [SESSION_REQUEST_EVENTS.REQUEST]: (payload: RequestSessionPayload) => void;
  [SESSION_REQUEST_EVENTS.ACCEPT]: (payload: SessionRequestReferencePayload) => void;
  [SESSION_REQUEST_EVENTS.REJECT]: (payload: SessionRequestReferencePayload) => void;
  [SESSION_REQUEST_EVENTS.CANCEL]: (payload: SessionRequestReferencePayload) => void;
  [SESSION_REQUEST_EVENTS.QUEUE_GET]: () => void;
}

interface SessionRequestServerEvents {
  [SESSION_REQUEST_EVENTS.REQUESTED]: (payload: SessionRequestedPayload) => void;
  [SESSION_REQUEST_EVENTS.CREATED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.ACCEPTED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.REJECTED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.CANCELLED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.TIMEOUT]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.QUEUE_UPDATED]: (payload: StudentQueuePayload) => void;
  [SESSION_REQUEST_EVENTS.QUEUE_CHANGED]: (payload: TeacherQueuePayload) => void;
  [SESSION_REQUEST_EVENTS.QUEUE_CLEARED]: () => void;
}

type SessionRequestServer = Server<SessionRequestClientEvents, SessionRequestServerEvents>;
type SessionRequestSocket = Socket<SessionRequestClientEvents, SessionRequestServerEvents>;

export class SessionRequestGateway {
  private readonly stopListeningForExpiration: () => void;
  private readonly stopListeningForQueue: () => void;
  private readonly stopListeningForEndedSessions: () => void;

  public constructor(
    private readonly socketServer: SessionRequestServer,
    private readonly manager: SessionRequestManager,
    private readonly logger: CommunicationLogger,
    private readonly sessionGateway: SessionGateway,
    private readonly sessionManager: SessionManager,
  ) {
    this.stopListeningForExpiration = manager.onExpired((delivery) => {
      this.emitRequestResult(SESSION_REQUEST_EVENTS.TIMEOUT, delivery);
      this.logger.info('Solicitação expirada', { requestId: delivery.request.requestId });
      this.promoteQueuedIfIdle(delivery.request.teacherId);
    });
    this.stopListeningForQueue = manager.onQueueChanged((teacherId, queue) => {
      this.emitQueueSnapshot(teacherId, queue);
    });
    this.stopListeningForEndedSessions = sessionManager.onSessionEnded((delivery) => {
      this.promoteNext(delivery.session.teacherId);
    });
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  public dispose(): void {
    this.stopListeningForExpiration();
    this.stopListeningForQueue();
    this.stopListeningForEndedSessions();
    this.manager.close();
  }

  private registerSocketEvents(socket: SessionRequestSocket): void {
    socket.on(SESSION_REQUEST_EVENTS.REQUEST, (payload) => {
      this.handleSafely('Nova solicitação inválida', () => {
        requireRole(socket, 'STUDENT', 'session.request');
        const delivery = this.manager.createRequest(socket.id, requireText(payload, 'teacherId'));
        const { request, teacherSocketId, queue } = delivery;
        this.logger.info('Nova solicitação', {
          requestId: request.requestId,
          studentId: request.studentId,
          teacherId: request.teacherId,
          queuePosition: queue?.position,
        });
        socket.emit(SESSION_REQUEST_EVENTS.CREATED, toResponsePayload(delivery));
        if (teacherSocketId !== undefined && queue !== undefined) {
          this.socketServer
            .to(teacherSocketId)
            .emit(SESSION_REQUEST_EVENTS.REQUESTED, toTeacherQueueEntry(queue));
          this.logger.info('Professor notificado', {
            requestId: request.requestId,
            teacherId: request.teacherId,
          });
        }
      });
    });

    socket.on(SESSION_REQUEST_EVENTS.ACCEPT, (payload) => {
      this.handleSafely('Não foi possível aceitar a solicitação', () => {
        const identity = requireRole(socket, 'TEACHER', 'session.respond');
        if (
          identity.profileId !== undefined &&
          this.sessionManager.hasActiveSessionForProfessor(identity.profileId)
        ) {
          throw new Error('Encerre o atendimento atual antes de chamar o próximo aluno');
        }
        const delivery = this.manager.acceptRequest(requireText(payload, 'requestId'), socket.id);
        this.emitStudentResponse(SESSION_REQUEST_EVENTS.ACCEPTED, delivery);
        this.logger.info('Solicitação aceita', { requestId: delivery.request.requestId });
        this.sessionGateway.startSession(delivery);
      });
    });

    socket.on(SESSION_REQUEST_EVENTS.REJECT, (payload) => {
      this.handleSafely('Não foi possível recusar a solicitação', () => {
        requireRole(socket, 'TEACHER', 'session.respond');
        const delivery = this.manager.rejectRequest(requireText(payload, 'requestId'), socket.id);
        this.emitStudentResponse(SESSION_REQUEST_EVENTS.REJECTED, delivery);
        this.logger.info('Solicitação recusada', { requestId: delivery.request.requestId });
      });
    });

    socket.on(SESSION_REQUEST_EVENTS.CANCEL, (payload) => {
      this.handleSafely('Não foi possível cancelar a solicitação', () => {
        requireRole(socket, 'STUDENT', 'session.request');
        const delivery = this.manager.cancelRequest(requireText(payload, 'requestId'), socket.id);
        this.emitRequestResult(SESSION_REQUEST_EVENTS.CANCELLED, delivery);
        this.promoteQueuedIfIdle(delivery.request.teacherId);
        this.logger.info('Solicitação cancelada', { requestId: delivery.request.requestId });
      });
    });

    socket.on(SESSION_REQUEST_EVENTS.QUEUE_GET, () => {
      this.handleSafely('Não foi possível consultar a fila', () =>
        this.emitQueueForIdentity(socket),
      );
    });

    socket.on('professor:online', () => {
      queueMicrotask(() => {
        const identity = readIdentity(socket);
        if (identity?.profileId !== undefined && identity.roles.includes('TEACHER')) {
          const queue = this.manager.synchronizeProfessorQueue(identity.profileId);
          if (
            !this.sessionManager.hasActiveSessionForProfessor(identity.profileId) &&
            queue[0]?.mode === 'queued'
          ) {
            this.promoteNext(identity.profileId);
          }
        }
        this.emitQueueForIdentity(socket);
      });
    });
    socket.on('student:register', () => {
      queueMicrotask(() => this.emitQueueForIdentity(socket));
    });
    socket.on('disconnect', () => {
      const identity = readIdentity(socket);
      if (identity?.roles.includes('TEACHER') === true && identity.profileId !== undefined) {
        queueMicrotask(() =>
          this.emitQueueSnapshot(
            identity.profileId ?? '',
            this.manager.getQueueForTeacher(identity.profileId ?? ''),
          ),
        );
      }
    });
  }

  private emitQueueForIdentity(socket: SessionRequestSocket): void {
    const identity = readIdentity(socket);
    if (identity?.profileId === undefined) throw new Error('Perfil autenticado obrigatório');
    if (identity.roles.includes('TEACHER')) {
      socket.emit(
        SESSION_REQUEST_EVENTS.QUEUE_CHANGED,
        toTeacherQueuePayload(
          identity.profileId,
          this.manager.getQueueForTeacher(identity.profileId),
        ),
      );
      return;
    }
    if (identity.roles.includes('STUDENT')) {
      const entry = this.manager.getQueueForStudent(identity.profileId);
      if (entry === undefined) socket.emit(SESSION_REQUEST_EVENTS.QUEUE_CLEARED);
      else socket.emit(SESSION_REQUEST_EVENTS.QUEUE_UPDATED, toStudentQueue(entry));
      return;
    }
    throw new Error('Operação não autorizada');
  }

  private promoteNext(teacherId: string): void {
    const next = this.manager.acceptNextRequest(teacherId);
    if (next === undefined) {
      if (!this.sessionManager.hasActiveSessionForProfessor(teacherId)) {
        this.manager.releaseProfessorIfQueueEmpty(teacherId);
      }
      return;
    }
    this.emitStudentResponse(SESSION_REQUEST_EVENTS.ACCEPTED, next);
    this.logger.info('Próximo aluno chamado automaticamente', {
      requestId: next.request.requestId,
      teacherId: next.request.teacherId,
    });
    this.sessionGateway.startSession(next);
  }

  private promoteQueuedIfIdle(teacherId: string): void {
    if (this.sessionManager.hasActiveSessionForProfessor(teacherId)) return;
    if (this.manager.getQueueForTeacher(teacherId)[0]?.mode === 'queued') {
      this.promoteNext(teacherId);
    } else {
      this.manager.releaseProfessorIfQueueEmpty(teacherId);
    }
  }

  private emitQueueSnapshot(teacherId: string, queue: readonly SessionQueueEntry[]): void {
    for (const socket of this.socketServer.sockets.sockets.values()) {
      const identity = readIdentity(socket);
      if (identity?.profileId === teacherId && identity.roles.includes('TEACHER')) {
        socket.emit(SESSION_REQUEST_EVENTS.QUEUE_CHANGED, toTeacherQueuePayload(teacherId, queue));
      }
    }
    for (const entry of queue) {
      for (const socket of this.socketServer.sockets.sockets.values()) {
        const identity = readIdentity(socket);
        if (identity?.profileId === entry.studentId && identity.roles.includes('STUDENT')) {
          socket.emit(SESSION_REQUEST_EVENTS.QUEUE_UPDATED, toStudentQueue(entry));
        }
      }
    }
  }

  private emitRequestResult(
    event: typeof SESSION_REQUEST_EVENTS.TIMEOUT | typeof SESSION_REQUEST_EVENTS.CANCELLED,
    delivery: SessionRequestDelivery,
  ): void {
    const payload = toResponsePayload(delivery);
    if (delivery.studentSocketId !== undefined) {
      this.socketServer.to(delivery.studentSocketId).emit(event, payload);
    }
    if (delivery.teacherSocketId !== undefined) {
      this.socketServer.to(delivery.teacherSocketId).emit(event, payload);
    }
  }

  private emitStudentResponse(
    event: typeof SESSION_REQUEST_EVENTS.ACCEPTED | typeof SESSION_REQUEST_EVENTS.REJECTED,
    delivery: SessionRequestDelivery,
  ): void {
    if (delivery.studentSocketId !== undefined) {
      this.socketServer.to(delivery.studentSocketId).emit(event, toResponsePayload(delivery));
    }
  }

  private handleSafely(message: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(message, error);
    }
  }
}

function toResponsePayload(delivery: SessionRequestDelivery): SessionResponsePayload {
  return {
    requestId: delivery.request.requestId,
    teacherId: delivery.request.teacherId,
    teacherName: delivery.request.teacherName,
  };
}

function toStudentQueue(entry: SessionQueueEntry): StudentQueuePayload {
  return {
    requestId: entry.requestId,
    teacherId: entry.teacherId,
    teacherName: entry.teacherName,
    position: entry.position,
    studentsAhead: entry.studentsAhead,
    totalWaiting: entry.totalWaiting,
    createdAt: entry.createdAt,
    ...(entry.queuedAt === undefined ? {} : { queuedAt: entry.queuedAt }),
    mode: entry.mode,
    teacherOnline: entry.teacherOnline,
  };
}

function toTeacherQueueEntry(entry: SessionQueueEntry): SessionRequestedPayload {
  return {
    requestId: entry.requestId,
    studentId: entry.studentId,
    studentName: entry.studentName,
    createdAt: entry.createdAt,
    ...(entry.queuedAt === undefined ? {} : { queuedAt: entry.queuedAt }),
    position: entry.position,
    mode: entry.mode,
  };
}

function toTeacherQueuePayload(
  teacherId: string,
  queue: readonly SessionQueueEntry[],
): TeacherQueuePayload {
  return {
    teacherId,
    totalWaiting: queue.length,
    requests: queue.map(toTeacherQueueEntry),
  };
}

function requireRole(
  socket: SessionRequestSocket,
  role: 'TEACHER' | 'STUDENT',
  permission: string,
): SocketIdentity {
  const identity = readIdentity(socket);
  if (
    identity === undefined ||
    !identity.roles.includes(role) ||
    !identity.permissions.includes(permission)
  ) {
    throw new Error('Operação não autorizada');
  }
  return identity;
}

function readIdentity(socket: SessionRequestSocket): SocketIdentity | undefined {
  return (socket.data as { identity?: SocketIdentity }).identity;
}

function requireText(payload: unknown, property: 'requestId' | 'teacherId'): string {
  if (typeof payload !== 'object' || payload === null || !(property in payload)) {
    throw new Error(`${property} é obrigatório`);
  }
  const value = (payload as Readonly<Record<string, unknown>>)[property];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${property} é obrigatório`);
  }
  return value.trim();
}
