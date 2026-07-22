import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SessionRequestDelivery } from '../session-request/session-request.types.js';
import type { SessionManager } from './session.manager.js';
import type { SessionDelivery } from './session.types.js';

export const SESSION_EVENTS = {
  STARTED: 'session:started',
  END: 'session:end',
  ENDED: 'session:ended',
} as const;

export interface SessionEndPayload {
  readonly sessionId: string;
}

export interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
}

interface SessionClientEvents {
  [SESSION_EVENTS.END]: (payload: SessionEndPayload) => void;
}

interface SessionServerEvents {
  [SESSION_EVENTS.STARTED]: (payload: SessionLifecyclePayload) => void;
  [SESSION_EVENTS.ENDED]: (payload: SessionLifecyclePayload) => void;
}

type ActiveSessionServer = Server<SessionClientEvents, SessionServerEvents>;
type ActiveSessionSocket = Socket<SessionClientEvents, SessionServerEvents>;

export class SessionGateway {
  public constructor(
    private readonly socketServer: ActiveSessionServer,
    private readonly manager: SessionManager,
    private readonly logger: CommunicationLogger,
  ) {}

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  public startSession(requestDelivery: SessionRequestDelivery): SessionDelivery {
    const delivery = this.manager.createSession(requestDelivery.request);

    this.logger.info('Sessão criada', {
      sessionId: delivery.session.sessionId,
      requestId: delivery.session.requestId,
    });
    this.emitToParticipants(SESSION_EVENTS.STARTED, delivery);
    this.logger.info('Participantes conectados', {
      sessionId: delivery.session.sessionId,
      participantCount: this.getParticipantSocketIds(delivery).length,
    });
    return delivery;
  }

  private registerSocketEvents(socket: ActiveSessionSocket): void {
    socket.on(SESSION_EVENTS.END, (payload) => {
      this.handleSafely(() => {
        const sessionId = requireSessionId(payload);
        const delivery = this.manager.endSession(sessionId, socket.id);

        this.logger.info('Sessão encerrada', { sessionId });
        this.emitToParticipants(SESSION_EVENTS.ENDED, delivery);
        this.logger.info('Sessão removida', { sessionId });
      });
    });
  }

  private emitToParticipants(
    event: typeof SESSION_EVENTS.STARTED | typeof SESSION_EVENTS.ENDED,
    delivery: SessionDelivery,
  ): void {
    const payload = toLifecyclePayload(delivery);
    for (const socketId of this.getParticipantSocketIds(delivery)) {
      this.socketServer.to(socketId).emit(event, payload);
    }
  }

  private getParticipantSocketIds(delivery: SessionDelivery): readonly string[] {
    return [delivery.teacherSocketId, delivery.studentSocketId].filter(
      (socketId): socketId is string => socketId !== undefined,
    );
  }

  private handleSafely(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error('Não foi possível encerrar a sessão', error);
    }
  }
}

function toLifecyclePayload(delivery: SessionDelivery): SessionLifecyclePayload {
  const { session } = delivery;
  return {
    sessionId: session.sessionId,
    teacherId: session.teacherId,
    teacherName: session.teacherName,
    studentId: session.studentId,
    studentName: session.studentName,
  };
}

function requireSessionId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('sessionId' in payload)) {
    throw new Error('sessionId é obrigatório');
  }
  const sessionId = payload.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('sessionId é obrigatório');
  }
  return sessionId.trim();
}
