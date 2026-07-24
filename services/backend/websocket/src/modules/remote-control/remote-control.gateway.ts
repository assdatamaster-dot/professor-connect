import {
  REMOTE_CONTROL_CHANNEL_EVENTS,
  type RemoteControlApproved,
  type RemoteControlDenied,
  type RemoteControlKeyboardEvent,
  type RemoteControlKeyboardPayload,
  type RemoteControlMouseEvent,
  type RemoteControlMousePayload,
  type RemoteControlRequest,
  type RemoteControlStopPayload,
} from '@professor-connect/protocol';
import type { Server, Socket } from 'socket.io';

import type { SessionManager } from '../active-session/session.manager.js';
import type { SessionDelivery, SessionSignalingRoute } from '../active-session/session.types.js';
import type { CommunicationLogger } from '../communication/communication.types.js';

interface RemoteControlClientEvents {
  [REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST]: (payload: RemoteControlRequest) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED]: (payload: RemoteControlApproved) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.DENIED]: (payload: RemoteControlDenied) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE]: (payload: RemoteControlMousePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD]: (payload: RemoteControlKeyboardPayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

type RemoteControlServerEvents = RemoteControlClientEvents;
type RemoteControlServer = Server<RemoteControlClientEvents, RemoteControlServerEvents>;
type RemoteControlSocket = Socket<RemoteControlClientEvents, RemoteControlServerEvents>;

interface RemoteControlAuthorization {
  readonly sessionId: string;
  readonly requestId: string;
  readonly status: 'pending' | 'active';
  readonly teacherSocketId: string;
  readonly studentSocketId: string;
}

export class RemoteControlGateway {
  private readonly authorizations = new Map<string, RemoteControlAuthorization>();
  private readonly unsubscribeSessionEnded: () => void;

  public constructor(
    private readonly socketServer: RemoteControlServer,
    private readonly sessionManager: SessionManager,
    private readonly logger: CommunicationLogger,
  ) {
    this.unsubscribeSessionEnded = this.sessionManager.onSessionEnded((delivery) => {
      this.handleSessionEnded(delivery);
    });
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  public dispose(): void {
    this.unsubscribeSessionEnded();
    this.authorizations.clear();
  }

  private registerSocketEvents(socket: RemoteControlSocket): void {
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, (payload) => {
      this.handleSafely('Solicitação de controle remoto inválida', () => {
        const request = requireReference(payload);
        const route = this.requireRoute(request.sessionId, socket.id, 'teacher');
        if (this.authorizations.has(request.sessionId)) {
          throw new Error('Já existe uma solicitação de controle remoto para a sessão');
        }

        this.authorizations.set(request.sessionId, {
          ...request,
          status: 'pending',
          teacherSocketId: socket.id,
          studentSocketId: route.recipientSocketId,
        });
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, request);
        this.logger.info('Solicitação enviada', {
          sessionId: request.sessionId,
          requestId: request.requestId,
          recipientSocketId: route.recipientSocketId,
        });
      });
    });

    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, (payload) => {
      this.handleSafely('Autorização de controle remoto inválida', () => {
        const approved = requireReference(payload);
        const route = this.requireRoute(approved.sessionId, socket.id, 'student');
        const authorization = this.requireAuthorization(approved, 'pending');
        this.authorizations.set(approved.sessionId, {
          ...authorization,
          status: 'active',
          studentSocketId: socket.id,
          teacherSocketId: route.recipientSocketId,
        });
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, approved);
        this.logger.info('Solicitação aceita', {
          sessionId: approved.sessionId,
          requestId: approved.requestId,
        });
      });
    });

    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, (payload) => {
      this.handleSafely('Recusa de controle remoto inválida', () => {
        const denied = requireReference(payload);
        const route = this.requireRoute(denied.sessionId, socket.id, 'student');
        this.requireAuthorization(denied, 'pending');
        this.authorizations.delete(denied.sessionId);
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, denied);
        this.logger.info('Solicitação negada', {
          sessionId: denied.sessionId,
          requestId: denied.requestId,
        });
      });
    });

    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, (payload) => {
      this.handleSafely('Evento de mouse inválido', () => {
        const normalized = requireMousePayload(payload);
        const route = this.requireRoute(normalized.sessionId, socket.id, 'teacher');
        this.requireAuthorization(normalized, 'active');
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, normalized);
        this.logReceivedEvent(normalized.sessionId, normalized.requestId, normalized.event.type);
      });
    });

    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, (payload) => {
      this.handleSafely('Evento de teclado inválido', () => {
        const normalized = requireKeyboardPayload(payload);
        const route = this.requireRoute(normalized.sessionId, socket.id, 'teacher');
        this.requireAuthorization(normalized, 'active');
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, normalized);
        this.logReceivedEvent(normalized.sessionId, normalized.requestId, normalized.event.type);
      });
    });

    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, (payload) => {
      this.handleSafely('Encerramento de controle remoto inválido', () => {
        const stopped = requireStopPayload(payload);
        const reference = requireReference(stopped);
        const route = this.sessionManager.resolveSignalingRoute(reference.sessionId, socket.id);
        this.requireAuthorization(reference);
        this.authorizations.delete(reference.sessionId);
        this.socketServer
          .to(route.recipientSocketId)
          .emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, stopped);
        this.logger.info('Controle encerrado', {
          sessionId: stopped.sessionId,
          requestId: stopped.requestId,
          reason: stopped.reason,
        });
      });
    });

    socket.on('disconnect', () => {
      this.handleParticipantDisconnected(socket.id);
    });
  }

  private requireRoute(
    sessionId: string,
    senderSocketId: string,
    expectedRole: SessionSignalingRoute['senderRole'],
  ): SessionSignalingRoute {
    const route = this.sessionManager.resolveSignalingRoute(sessionId, senderSocketId);
    if (route.senderRole !== expectedRole) {
      throw new Error(
        expectedRole === 'teacher'
          ? 'Somente o professor participante pode enviar este evento'
          : 'Somente o aluno participante pode enviar este evento',
      );
    }
    return route;
  }

  private requireAuthorization(
    reference: RemoteControlRequest,
    expectedStatus?: RemoteControlAuthorization['status'],
  ): RemoteControlAuthorization {
    const authorization = this.authorizations.get(reference.sessionId);
    if (
      authorization === undefined ||
      authorization.requestId !== reference.requestId ||
      (expectedStatus !== undefined && authorization.status !== expectedStatus)
    ) {
      throw new Error('Controle remoto não autorizado para a sessão');
    }
    return authorization;
  }

  private handleSessionEnded(delivery: SessionDelivery): void {
    const authorization = this.authorizations.get(delivery.session.sessionId);
    if (authorization === undefined) {
      return;
    }

    this.authorizations.delete(authorization.sessionId);
    const payload: RemoteControlStopPayload = {
      sessionId: authorization.sessionId,
      requestId: authorization.requestId,
      reason: 'session-ended',
    };
    const participantSocketIds = new Set(
      [delivery.teacherSocketId, delivery.studentSocketId].filter(
        (socketId): socketId is string => socketId !== undefined,
      ),
    );
    for (const socketId of participantSocketIds) {
      this.socketServer.to(socketId).emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, payload);
    }
    this.logger.info('Controle encerrado', {
      sessionId: payload.sessionId,
      requestId: payload.requestId,
      reason: payload.reason,
    });
  }

  private handleParticipantDisconnected(socketId: string): void {
    for (const authorization of this.authorizations.values()) {
      if (
        authorization.teacherSocketId !== socketId &&
        authorization.studentSocketId !== socketId
      ) {
        continue;
      }

      this.authorizations.delete(authorization.sessionId);
      const recipientSocketId =
        authorization.teacherSocketId === socketId
          ? authorization.studentSocketId
          : authorization.teacherSocketId;
      const payload: RemoteControlStopPayload = {
        sessionId: authorization.sessionId,
        requestId: authorization.requestId,
        reason: 'disconnect',
      };
      this.socketServer.to(recipientSocketId).emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, payload);
      this.logger.info('Controle encerrado', {
        sessionId: payload.sessionId,
        requestId: payload.requestId,
        reason: payload.reason,
      });
    }
  }

  private logReceivedEvent(sessionId: string, requestId: string, eventType: string): void {
    this.logger.info('Evento recebido', { sessionId, requestId, eventType });
  }

  private handleSafely(message: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(message, error);
    }
  }
}

function requireReference(payload: unknown): RemoteControlRequest {
  const record = requireRecord(payload, 'Payload de controle remoto');
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    requestId: requireText(record.requestId, 'requestId'),
  };
}

function requireMousePayload(payload: unknown): RemoteControlMousePayload {
  const reference = requireReference(payload);
  const record = requireRecord(payload, 'Payload de mouse');
  const event = requireRecord(record.event, 'Evento de mouse');
  const type = event.type;
  if (
    type !== 'mousemove' &&
    type !== 'mousedown' &&
    type !== 'mouseup' &&
    type !== 'dblclick' &&
    type !== 'wheel'
  ) {
    throw new Error('Tipo de evento de mouse inválido');
  }

  const normalized: RemoteControlMouseEvent = {
    type,
    x: requireNumberInRange(event.x, 'event.x', 0, 1),
    y: requireNumberInRange(event.y, 'event.y', 0, 1),
    button: requireIntegerInRange(event.button, 'event.button', 0, 4),
    buttons: requireIntegerInRange(event.buttons, 'event.buttons', 0, 31),
    ...(type === 'wheel'
      ? {
          deltaX: requireNumberInRange(event.deltaX, 'event.deltaX', -100_000, 100_000),
          deltaY: requireNumberInRange(event.deltaY, 'event.deltaY', -100_000, 100_000),
          deltaMode: requireIntegerInRange(event.deltaMode, 'event.deltaMode', 0, 2),
        }
      : {}),
  };
  return { ...reference, event: normalized };
}

function requireStopPayload(payload: unknown): RemoteControlStopPayload {
  const reference = requireReference(payload);
  const record = requireRecord(payload, 'Payload de encerramento');
  const reason = record.reason;
  if (
    reason !== 'participant' &&
    reason !== 'session-ended' &&
    reason !== 'disconnect' &&
    reason !== 'focus-lost' &&
    reason !== 'execution-error'
  ) {
    throw new Error('Motivo de encerramento de controle remoto inválido');
  }
  return { ...reference, reason };
}

function requireKeyboardPayload(payload: unknown): RemoteControlKeyboardPayload {
  const reference = requireReference(payload);
  const record = requireRecord(payload, 'Payload de teclado');
  const event = requireRecord(record.event, 'Evento de teclado');
  if (event.type !== 'keydown' && event.type !== 'keyup' && event.type !== 'keypress') {
    throw new Error('Tipo de evento de teclado inválido');
  }

  const normalized: RemoteControlKeyboardEvent = {
    type: event.type,
    key: requireKeyboardKey(event.key),
    code: requireText(event.code, 'event.code', 100),
    repeat: requireBoolean(event.repeat, 'event.repeat'),
    altKey: requireBoolean(event.altKey, 'event.altKey'),
    ctrlKey: requireBoolean(event.ctrlKey, 'event.ctrlKey'),
    shiftKey: requireBoolean(event.shiftKey, 'event.shiftKey'),
    metaKey: requireBoolean(event.metaKey, 'event.metaKey'),
  };
  return { ...reference, event: normalized };
}

function requireKeyboardKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    throw new Error('event.key deve conter entre 1 e 100 caracteres');
  }
  return value;
}

function requireRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${name} deve ser um objeto`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: unknown, name: string, maximumLength = 128): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} deve ser texto`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new Error(`${name} deve conter entre 1 e ${maximumLength} caracteres`);
  }
  return normalized;
}

function requireNumberInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} está fora do intervalo permitido`);
  }
  return value;
}

function requireIntegerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const normalized = requireNumberInRange(value, name, minimum, maximum);
  if (!Number.isInteger(normalized)) {
    throw new Error(`${name} deve ser inteiro`);
  }
  return normalized;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} deve ser booleano`);
  }
  return value;
}
