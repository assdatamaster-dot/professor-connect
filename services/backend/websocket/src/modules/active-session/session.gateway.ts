import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SessionRequestDelivery } from '../session-request/session-request.types.js';
import type { SessionManager } from './session.manager.js';
import type { SessionDelivery } from './session.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import { RecoveryCoordinator } from './recovery-coordinator.js';

export const SESSION_EVENTS = {
  STARTED: 'session:started',
  END: 'session:end',
  ENDED: 'session:ended',
  RECONNECTING: 'session:reconnecting',
  RECOVER: 'session:recover',
  RECOVERED: 'session:recovered',
} as const;

export interface SessionEndPayload {
  readonly sessionId: string;
  readonly recoveryToken?: string;
}

export interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly state: 'CONNECTED' | 'RECONNECTING' | 'RECOVERING' | 'FINISHED';
  readonly recoveryDeadline?: string;
  readonly recoveryToken?: string;
}

export interface SessionRecoverPayload {
  readonly sessionId: string;
  readonly recoveryToken: string;
}

export interface SessionRecoveryAcknowledgement {
  readonly ok: boolean;
  readonly message?: string;
}

interface SessionClientEvents {
  [SESSION_EVENTS.END]: (payload: SessionEndPayload) => void;
  [SESSION_EVENTS.RECOVER]: (
    payload: SessionRecoverPayload,
    acknowledge?: (result: SessionRecoveryAcknowledgement) => void,
  ) => void;
}

interface SessionServerEvents {
  [SESSION_EVENTS.STARTED]: (payload: SessionLifecyclePayload) => void;
  [SESSION_EVENTS.ENDED]: (payload: SessionLifecyclePayload) => void;
  [SESSION_EVENTS.RECONNECTING]: (payload: SessionLifecyclePayload) => void;
  [SESSION_EVENTS.RECOVERED]: (payload: SessionLifecyclePayload) => void;
}

type ActiveSessionServer = Server<SessionClientEvents, SessionServerEvents>;
type ActiveSessionSocket = Socket<SessionClientEvents, SessionServerEvents>;

export class SessionGateway {
  private readonly recoveryCoordinator: RecoveryCoordinator;
  public constructor(
    private readonly socketServer: ActiveSessionServer,
    private readonly manager: SessionManager,
    private readonly logger: CommunicationLogger,
  ) {
    this.recoveryCoordinator = new RecoveryCoordinator(manager);
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
    for (const session of this.manager.listActiveSessions()) {
      if (session.recoveryDeadline !== undefined) this.scheduleRecoveryExpiry(session.sessionId);
    }
  }

  public dispose(): void {
    this.recoveryCoordinator.dispose();
  }

  public startSession(requestDelivery: SessionRequestDelivery): SessionDelivery {
    const delivery = this.manager.createSession(requestDelivery.request);

    this.logger.info('Sessão criada', {
      sessionId: delivery.session.sessionId,
      requestId: delivery.session.requestId,
    });
    this.emitStarted(delivery);
    this.logger.info('Participantes conectados', {
      sessionId: delivery.session.sessionId,
      participantCount: this.getParticipantSocketIds(delivery).length,
    });
    return delivery;
  }

  private registerSocketEvents(socket: ActiveSessionSocket): void {
    socket.on(SESSION_EVENTS.END, (payload) => {
      this.handleSafely(() => {
        const normalized = requireSessionEndPayload(payload);
        const delivery =
          normalized.recoveryToken === undefined
            ? this.manager.endSession(normalized.sessionId, socket.id)
            : this.manager.endRecoverableSession(
                normalized.sessionId,
                normalized.recoveryToken,
                readIdentity(socket),
              );

        this.finishSessionDelivery(delivery);
      });
    });
    socket.on(SESSION_EVENTS.RECOVER, (payload, acknowledge) => {
      this.handleSafely(() => {
        const normalized = requireRecoveryPayload(payload);
        const delivery = this.manager.recoverSession(
          normalized.sessionId,
          normalized.recoveryToken,
          socket.id,
          readIdentity(socket),
        );
        if (delivery.fullyRecovered) this.recoveryCoordinator.clear(delivery.session.sessionId);
        else this.scheduleRecoveryExpiry(delivery.session.sessionId);
        this.emitRecovered(delivery);
        acknowledge?.({ ok: true });
        this.logger.info('Sessão recuperada', {
          sessionId: delivery.session.sessionId,
          recoveredRole: delivery.recoveredRole,
          fullyRecovered: delivery.fullyRecovered,
        });
      }, acknowledge);
    });
    socket.on('disconnect', () => {
      for (const delivery of this.manager.markParticipantDisconnected(socket.id)) {
        this.emitToParticipants(SESSION_EVENTS.RECONNECTING, delivery);
        this.scheduleRecoveryExpiry(delivery.session.sessionId);
        this.logger.info('Participante temporariamente desconectado', {
          sessionId: delivery.session.sessionId,
          recoveryDeadline: delivery.session.recoveryDeadline,
        });
      }
    });
  }

  private finishSessionDelivery(delivery: SessionDelivery): void {
    const { sessionId } = delivery.session;
    this.recoveryCoordinator.clear(sessionId);
    this.logger.info('Sessão encerrada', { sessionId });
    this.emitToParticipants(SESSION_EVENTS.ENDED, delivery);
    this.logger.info('Sessão removida', { sessionId });
  }

  private emitToParticipants(
    event:
      | typeof SESSION_EVENTS.ENDED
      | typeof SESSION_EVENTS.RECONNECTING
      | typeof SESSION_EVENTS.RECOVERED,
    delivery: SessionDelivery,
  ): void {
    const payload = toLifecyclePayload(delivery);
    for (const socketId of this.getParticipantSocketIds(delivery)) {
      this.socketServer.to(socketId).emit(event, payload);
    }
  }

  private emitStarted(delivery: SessionDelivery): void {
    if (delivery.teacherSocketId !== undefined) {
      this.socketServer.to(delivery.teacherSocketId).emit(SESSION_EVENTS.STARTED, {
        ...toLifecyclePayload(delivery),
        ...(delivery.teacherRecoveryToken === undefined
          ? {}
          : { recoveryToken: delivery.teacherRecoveryToken }),
      });
    }
    if (delivery.studentSocketId !== undefined) {
      this.socketServer.to(delivery.studentSocketId).emit(SESSION_EVENTS.STARTED, {
        ...toLifecyclePayload(delivery),
        ...(delivery.studentRecoveryToken === undefined
          ? {}
          : { recoveryToken: delivery.studentRecoveryToken }),
      });
    }
  }

  private emitRecovered(
    delivery: SessionDelivery & { recoveredRole: 'teacher' | 'student'; recoveryToken: string },
  ): void {
    for (const socketId of this.getParticipantSocketIds(delivery)) {
      const recoveredSocketId =
        delivery.recoveredRole === 'teacher' ? delivery.teacherSocketId : delivery.studentSocketId;
      this.socketServer.to(socketId).emit(SESSION_EVENTS.RECOVERED, {
        ...toLifecyclePayload(delivery),
        ...(socketId === recoveredSocketId ? { recoveryToken: delivery.recoveryToken } : {}),
      });
    }
  }

  private scheduleRecoveryExpiry(sessionId: string): void {
    this.recoveryCoordinator.schedule(sessionId, (delivery) =>
      this.finishSessionDelivery(delivery),
    );
  }

  private getParticipantSocketIds(delivery: SessionDelivery): readonly string[] {
    return [delivery.teacherSocketId, delivery.studentSocketId].filter(
      (socketId): socketId is string => socketId !== undefined,
    );
  }

  private handleSafely(
    action: () => void,
    acknowledge?: (result: SessionRecoveryAcknowledgement) => void,
  ): void {
    try {
      action();
    } catch (error) {
      this.logger.error('Não foi possível encerrar a sessão', error);
      acknowledge?.({
        ok: false,
        message: error instanceof Error ? error.message : 'Falha na recuperação',
      });
    }
  }
}

function toLifecyclePayload(delivery: SessionDelivery): SessionLifecyclePayload {
  const { session } = delivery;
  return {
    sessionId: session.sessionId,
    requestId: session.requestId,
    teacherId: session.teacherId,
    teacherName: session.teacherName,
    studentId: session.studentId,
    studentName: session.studentName,
    state:
      session.connectionState === 'RECONNECTING' || session.connectionState === 'RECOVERING'
        ? session.connectionState
        : session.status === 'finished'
          ? 'FINISHED'
          : 'CONNECTED',
    ...(session.recoveryDeadline === undefined
      ? {}
      : { recoveryDeadline: session.recoveryDeadline }),
  };
}

function requireRecoveryPayload(payload: unknown): SessionRecoverPayload {
  if (typeof payload !== 'object' || payload === null)
    throw new Error('Payload de recuperação inválido');
  const record = payload as Record<string, unknown>;
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  const recoveryToken = typeof record.recoveryToken === 'string' ? record.recoveryToken.trim() : '';
  if (sessionId.length === 0 || recoveryToken.length < 32 || recoveryToken.length > 256) {
    throw new Error('Credenciais de recuperação inválidas');
  }
  return { sessionId, recoveryToken };
}

function readIdentity(socket: ActiveSessionSocket): SocketIdentity | undefined {
  return (socket.data as { identity?: SocketIdentity }).identity;
}

function requireSessionEndPayload(payload: unknown): SessionEndPayload {
  if (typeof payload !== 'object' || payload === null || !('sessionId' in payload)) {
    throw new Error('sessionId é obrigatório');
  }
  const sessionId = payload.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('sessionId é obrigatório');
  }
  const recoveryToken = 'recoveryToken' in payload ? payload.recoveryToken : undefined;
  if (
    recoveryToken !== undefined &&
    (typeof recoveryToken !== 'string' || recoveryToken.length < 32)
  ) {
    throw new Error('recoveryToken inválido');
  }
  return {
    sessionId: sessionId.trim(),
    ...(typeof recoveryToken === 'string' ? { recoveryToken } : {}),
  };
}
