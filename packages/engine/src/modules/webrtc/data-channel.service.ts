import {
  DataChannelMessageType,
  EventType,
  type DataChannelMessage,
  type DataChannelPayload,
  type SocketMessage,
} from '@professor-connect/protocol';

import { PEER_EVENTS } from './peer.events.js';
import type {
  DataChannelEventListener,
  DataChannelFailureListener,
  DataChannelLifecycleListener,
  DataChannelMessageListener,
  DataChannelPort,
  DataChannelSocketMessage,
} from './peer.types.js';
import type { WebRtcClock, WebRtcLogger, WebRtcMessageIdFactory } from './webrtc.types.js';

export const DEFAULT_DATA_CHANNEL_LABEL = 'professor-connect-control';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class DataChannelService {
  private readonly channels = new Map<string, DataChannelPort>();
  private readonly sessions = new Map<string, string>();
  private readonly openCalls = new Set<string>();
  private readonly openListeners = new Set<DataChannelLifecycleListener>();
  private readonly closeListeners = new Set<DataChannelLifecycleListener>();
  private readonly failureListeners = new Set<DataChannelFailureListener>();
  private readonly messageListeners = new Set<DataChannelMessageListener>();
  private readonly eventListeners = new Set<DataChannelEventListener>();

  public constructor(
    private readonly logger: WebRtcLogger = silentLogger,
    private readonly messageIdFactory: WebRtcMessageIdFactory = () =>
      globalThis.crypto.randomUUID(),
    private readonly clock: WebRtcClock = () => new Date(),
  ) {}

  public attach(callId: string, sessionId: string, channel: DataChannelPort): void {
    if (channel.label !== DEFAULT_DATA_CHANNEL_LABEL) {
      throw new Error(`DataChannel inválido: ${channel.label}`);
    }

    if (this.channels.has(callId)) {
      throw new Error(`DataChannel já registrado: ${callId}`);
    }

    this.channels.set(callId, channel);
    this.sessions.set(callId, sessionId);
    channel.setOpenHandler(() => this.handleOpen(callId));
    channel.setCloseHandler(() => this.handleClose(callId));
    channel.setErrorHandler((error) => this.handleError(callId, error));
    channel.setMessageHandler((data) => this.handleMessage(callId, data));

    if (channel.readyState === 'open') {
      this.handleOpen(callId);
    }
  }

  public send(callId: string, payload: DataChannelPayload): DataChannelSocketMessage {
    const timestamp = this.clock().toISOString();
    const dataChannelMessage: DataChannelMessage<DataChannelPayload> = {
      type: DataChannelMessageType.PEER_MESSAGE,
      timestamp,
      payload,
    };
    return this.sendEvent(callId, PEER_EVENTS.dataChannelMessage, dataChannelMessage);
  }

  public sendEvent<TPayload>(
    callId: string,
    event: EventType,
    payload: TPayload,
  ): SocketMessage<TPayload> {
    const channel = this.requireChannel(callId);
    const sessionId = this.requireSession(callId);

    if (channel.readyState !== 'open') {
      throw new Error(`DataChannel não está aberto: ${callId}`);
    }

    const message: SocketMessage<TPayload> = {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      sessionId,
      payload,
    };

    channel.send(JSON.stringify(message));
    this.logger.info('Mensagem enviada', { callId, sessionId, event });
    return message;
  }

  public isOpen(callId: string): boolean {
    return this.channels.get(callId)?.readyState === 'open';
  }

  public close(callId: string): void {
    const channel = this.channels.get(callId);

    if (channel !== undefined && channel.readyState !== 'closed') {
      channel.close();
    }
    this.channels.delete(callId);
    this.sessions.delete(callId);
    this.openCalls.delete(callId);
  }

  public onOpen(listener: DataChannelLifecycleListener): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  public onClose(listener: DataChannelLifecycleListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  public onError(listener: DataChannelFailureListener): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  public onMessage(listener: DataChannelMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onEvent(listener: DataChannelEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private handleOpen(callId: string): void {
    if (this.openCalls.has(callId)) {
      return;
    }

    this.openCalls.add(callId);
    this.logger.info('DataChannel aberto', { callId });
    for (const listener of this.openListeners) {
      listener(callId);
    }
  }

  private handleClose(callId: string): void {
    this.channels.delete(callId);
    this.sessions.delete(callId);
    this.openCalls.delete(callId);
    this.logger.info('DataChannel fechado', { callId });
    for (const listener of this.closeListeners) {
      listener(callId);
    }
  }

  private handleError(callId: string, error: unknown): void {
    this.logger.error('Erro', error);
    for (const listener of this.failureListeners) {
      listener(callId, error);
    }
  }

  private handleMessage(callId: string, data: string): void {
    try {
      const message = parseSocketMessage(data, this.requireSession(callId));

      this.logger.info('Mensagem recebida', {
        callId,
        sessionId: message.sessionId,
        event: message.event,
      });
      for (const listener of this.eventListeners) {
        listener(callId, message);
      }
      if (message.event === EventType.WEBRTC_DATA_CHANNEL_MESSAGE) {
        const dataChannelMessage = parseDataChannelMessage(message);

        for (const listener of this.messageListeners) {
          listener(callId, dataChannelMessage);
        }
      }
    } catch (error) {
      this.handleError(callId, error);
    }
  }

  private requireChannel(callId: string): DataChannelPort {
    const channel = this.channels.get(callId);

    if (channel === undefined) {
      throw new Error(`DataChannel não encontrado: ${callId}`);
    }

    return channel;
  }

  private requireSession(callId: string): string {
    const sessionId = this.sessions.get(callId);

    if (sessionId === undefined) {
      throw new Error(`Sessão do DataChannel não encontrada: ${callId}`);
    }

    return sessionId;
  }
}

function parseSocketMessage(data: string, expectedSessionId: string): SocketMessage<unknown> {
  if (data.length === 0) {
    throw new Error('Mensagem do DataChannel deve ser uma string JSON');
  }

  const parsed: unknown = JSON.parse(data);

  if (!isRecord(parsed) || !('payload' in parsed)) {
    throw new Error('Mensagem do DataChannel possui estrutura inválida');
  }

  if (
    typeof parsed.id !== 'string' ||
    parsed.id.trim().length === 0 ||
    typeof parsed.event !== 'string' ||
    !isEventType(parsed.event) ||
    typeof parsed.timestamp !== 'string' ||
    Number.isNaN(Date.parse(parsed.timestamp)) ||
    parsed.sessionId !== expectedSessionId
  ) {
    throw new Error('Mensagem do DataChannel possui campos inválidos');
  }

  return {
    id: parsed.id,
    event: parsed.event,
    timestamp: parsed.timestamp,
    sessionId: expectedSessionId,
    payload: parsed.payload,
  };
}

function parseDataChannelMessage(message: SocketMessage<unknown>): DataChannelSocketMessage {
  const payload = message.payload;

  if (
    !isRecord(payload) ||
    !isRecord(payload.payload) ||
    payload.type !== DataChannelMessageType.PEER_MESSAGE ||
    typeof payload.timestamp !== 'string' ||
    Number.isNaN(Date.parse(payload.timestamp)) ||
    typeof payload.payload.value !== 'string'
  ) {
    throw new Error('Mensagem do DataChannel possui campos inválidos');
  }

  return {
    ...message,
    event: EventType.WEBRTC_DATA_CHANNEL_MESSAGE,
    payload: {
      type: DataChannelMessageType.PEER_MESSAGE,
      timestamp: payload.timestamp,
      payload: { value: payload.payload.value },
    },
  };
}

function isEventType(value: string): value is EventType {
  return (Object.values(EventType) as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
