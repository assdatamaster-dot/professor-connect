import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { SessionGateway } from '../active-session/session.gateway.js';
import type { SessionRequestManager } from './session-request.manager.js';

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
}

export interface SessionResponsePayload {
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
}

interface SessionRequestClientEvents {
  [SESSION_REQUEST_EVENTS.REQUEST]: (payload: RequestSessionPayload) => void;
  [SESSION_REQUEST_EVENTS.ACCEPT]: (payload: SessionRequestReferencePayload) => void;
  [SESSION_REQUEST_EVENTS.REJECT]: (payload: SessionRequestReferencePayload) => void;
  [SESSION_REQUEST_EVENTS.CANCEL]: (payload: SessionRequestReferencePayload) => void;
}

interface SessionRequestServerEvents {
  [SESSION_REQUEST_EVENTS.REQUESTED]: (payload: SessionRequestedPayload) => void;
  [SESSION_REQUEST_EVENTS.CREATED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.ACCEPTED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.REJECTED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.CANCELLED]: (payload: SessionResponsePayload) => void;
  [SESSION_REQUEST_EVENTS.TIMEOUT]: (payload: SessionResponsePayload) => void;
}

type SessionRequestServer = Server<SessionRequestClientEvents, SessionRequestServerEvents>;
type SessionRequestSocket = Socket<SessionRequestClientEvents, SessionRequestServerEvents>;

export class SessionRequestGateway {
  private readonly stopListeningForExpiration: () => void;

  public constructor(
    private readonly socketServer: SessionRequestServer,
    private readonly manager: SessionRequestManager,
    private readonly logger: CommunicationLogger,
    private readonly sessionGateway: SessionGateway,
  ) {
    this.stopListeningForExpiration = manager.onExpired((delivery) => {
      const { request, studentSocketId, teacherSocketId } = delivery;
      const payload = {
        requestId: request.requestId,
        teacherId: request.teacherId,
        teacherName: request.teacherName,
      };
      if (studentSocketId !== undefined) {
        this.socketServer.to(studentSocketId).emit(SESSION_REQUEST_EVENTS.TIMEOUT, payload);
      }
      if (teacherSocketId !== undefined) {
        this.socketServer.to(teacherSocketId).emit(SESSION_REQUEST_EVENTS.TIMEOUT, payload);
      }
      this.logger.info('Solicitação expirada', { requestId: request.requestId });
    });
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  public dispose(): void {
    this.stopListeningForExpiration();
    this.manager.close();
  }

  private registerSocketEvents(socket: SessionRequestSocket): void {
    socket.on(SESSION_REQUEST_EVENTS.REQUEST, (payload) => {
      this.handleSafely('Nova solicitação inválida', () => {
        requireRole(socket, 'STUDENT', 'session.request');
        const teacherId = requireText(payload, 'teacherId');
        const delivery = this.manager.createRequest(socket.id, teacherId);
        const { request, teacherSocketId } = delivery;

        this.logger.info('Nova solicitação', {
          requestId: request.requestId,
          studentId: request.studentId,
          teacherId: request.teacherId,
        });
        socket.emit(SESSION_REQUEST_EVENTS.CREATED, {
          requestId: request.requestId,
          teacherId: request.teacherId,
          teacherName: request.teacherName,
        });
        if (teacherSocketId === undefined) {
          throw new Error('Professor não está online');
        }
        this.socketServer.to(teacherSocketId).emit(SESSION_REQUEST_EVENTS.REQUESTED, {
          requestId: request.requestId,
          studentId: request.studentId,
          studentName: request.studentName,
        });
        this.logger.info('Professor notificado', {
          requestId: request.requestId,
          teacherId: request.teacherId,
        });
      });
    });

    socket.on(SESSION_REQUEST_EVENTS.ACCEPT, (payload) => {
      this.handleSafely('Não foi possível aceitar a solicitação', () => {
        requireRole(socket, 'TEACHER', 'session.respond');
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
        const response = {
          requestId: delivery.request.requestId,
          teacherId: delivery.request.teacherId,
          teacherName: delivery.request.teacherName,
        };
        if (delivery.teacherSocketId !== undefined) {
          this.socketServer
            .to(delivery.teacherSocketId)
            .emit(SESSION_REQUEST_EVENTS.CANCELLED, response);
        }
        socket.emit(SESSION_REQUEST_EVENTS.CANCELLED, response);
        this.logger.info('Solicitação cancelada', { requestId: delivery.request.requestId });
      });
    });
  }

  private emitStudentResponse(
    event: typeof SESSION_REQUEST_EVENTS.ACCEPTED | typeof SESSION_REQUEST_EVENTS.REJECTED,
    delivery: ReturnType<SessionRequestManager['acceptRequest']>,
  ): void {
    if (delivery.studentSocketId === undefined) {
      return;
    }
    this.socketServer.to(delivery.studentSocketId).emit(event, {
      requestId: delivery.request.requestId,
      teacherId: delivery.request.teacherId,
      teacherName: delivery.request.teacherName,
    });
  }

  private handleSafely(message: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(message, error);
    }
  }
}

function requireRole(
  socket: SessionRequestSocket,
  role: 'TEACHER' | 'STUDENT',
  permission: string,
): SocketIdentity {
  const identity = (socket.data as { identity?: SocketIdentity }).identity;
  if (
    identity === undefined ||
    !identity.roles.includes(role) ||
    !identity.permissions.includes(permission)
  ) {
    throw new Error('Operação não autorizada');
  }
  return identity;
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
