import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createStructuredLogger } from '@professor-connect/engine';
import {
  REMOTE_CONTROL_CHANNEL_EVENTS,
  type RemoteControlApproved,
  type RemoteControlDenied,
  type RemoteControlKeyboardPayload,
  type RemoteControlMousePayload,
  type RemoteControlRequest,
  type RemoteControlStopPayload,
} from '@professor-connect/protocol';
import { io, type Socket } from 'socket.io-client';
import type { FileTransferAuditEntry } from '@professor-connect/engine/file-transfer-node';

import type {
  AvailableTeachersListener,
  AttendanceHistoryItem,
  OnlineTeacher,
  StudentSessionListener,
  StudentSessionSnapshot,
} from '../shared/session-contracts.js';
import type {
  WebRtcDescriptionListener,
  WebRtcDescriptionPayload,
  WebRtcIceCandidateListener,
  WebRtcIceCandidatePayload,
  ScreenSharePayload,
} from '../shared/webrtc-contracts.js';
import { RemoteControlReceiver } from './remote-control.receiver.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const SOCKET_AUTH_REFRESH_INTERVAL_MS = 60_000;
const remoteControlLogger = createStructuredLogger('student-presence.remote-control');

export interface StudentIdentity {
  readonly id: string;
  readonly name: string;
}

interface StudentPresenceClientEvents {
  'auth:refresh': (
    payload: { readonly token: string },
    acknowledge?: (result: { readonly ok: boolean }) => void,
  ) => void;
  'file-transfer:audit': (payload: FileTransferAuditEntry & { readonly sessionId: string }) => void;
  'student:disconnect': (acknowledge: () => void) => void;
  'student:heartbeat': () => void;
  'student:register': (payload: StudentIdentity) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:cancel': (payload: { readonly requestId: string }) => void;
  'professor:availability:get': () => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED]: (payload: RemoteControlApproved) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.DENIED]: (payload: RemoteControlDenied) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface StudentPresenceServerEvents {
  'professors:available:list': (payload: readonly OnlineTeacher[]) => void;
  'session:pending': (payload: SessionResponsePayload) => void;
  'session:accepted': (payload: SessionResponsePayload) => void;
  'session:rejected': (payload: SessionResponsePayload) => void;
  'session:cancelled': (payload: SessionResponsePayload) => void;
  'session:timeout': (payload: SessionResponsePayload) => void;
  'session:started': (payload: SessionLifecyclePayload) => void;
  'session:ended': (payload: SessionLifecyclePayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST]: (payload: RemoteControlRequest) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE]: (payload: RemoteControlMousePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD]: (payload: RemoteControlKeyboardPayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface SessionResponsePayload {
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
}

interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
}

interface StudentConnectConfig {
  readonly serverUrl: string;
}

type StudentPresenceSocket = Socket<StudentPresenceServerEvents, StudentPresenceClientEvents>;

export interface AuthenticatedTransport {
  getAccessToken(): Promise<string>;
  fetch(input: URL | string, init?: RequestInit): Promise<Response>;
}

export class StudentPresenceController {
  private readonly sessionListeners = new Set<StudentSessionListener>();
  private readonly availableTeachersListeners = new Set<AvailableTeachersListener>();
  private readonly offerListeners = new Set<WebRtcDescriptionListener>();
  private readonly answerListeners = new Set<WebRtcDescriptionListener>();
  private readonly iceCandidateListeners = new Set<WebRtcIceCandidateListener>();
  private readonly remoteControlReceiver: RemoteControlReceiver;
  private readonly unsubscribeRemoteControl: () => void;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private authRefreshTimer: NodeJS.Timeout | undefined;
  private socket: StudentPresenceSocket | undefined;
  private availableTeachers: readonly OnlineTeacher[] = [];
  private sessionState: Omit<StudentSessionSnapshot, 'remoteControl'> = {
    status: 'idle',
    message: 'Pronto para solicitar atendimento.',
    activeSessionId: undefined,
    activeTeacherName: undefined,
    pendingRequestId: undefined,
  };

  public constructor(
    private readonly configPath: string,
    private readonly identity: StudentIdentity = { id: randomUUID(), name: 'Aluno' },
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    remoteControlReceiver = new RemoteControlReceiver(),
    private readonly authenticatedTransport?: AuthenticatedTransport,
  ) {
    this.remoteControlReceiver = remoteControlReceiver;
    this.unsubscribeRemoteControl = this.remoteControlReceiver.onStateChanged(() => {
      this.notifySessionListeners();
    });
  }

  public async connect(): Promise<void> {
    this.disconnectSocket();

    const { serverUrl } = await this.loadConfig();
    const accessToken = await this.authenticatedTransport?.getAccessToken();
    const socket: StudentPresenceSocket = io(serverUrl, {
      autoConnect: false,
      ...(accessToken === undefined ? {} : { auth: { token: accessToken } }),
    });

    this.socket = socket;
    socket.on('connect', () => {
      socket.emit('student:register', this.identity);
      socket.emit('professor:availability:get');
      this.startHeartbeat(socket);
      this.startAuthRefresh(socket);
    });
    socket.on('professors:available:list', (teachers) => {
      this.availableTeachers = teachers.filter(isOnlineTeacher);
      this.notifyAvailableTeachersListeners();
    });
    socket.on('session:pending', (payload) => {
      this.updateSessionState(
        'waiting',
        `Solicitação enviada para ${payload.teacherName}.`,
        undefined,
        payload.teacherName,
        payload.requestId,
      );
    });
    socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.remoteControlReceiver.handleTransportLoss();
    });
    socket.on('connect_error', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.remoteControlReceiver.handleTransportLoss();
    });
    socket.on('session:accepted', () => {
      this.updateSessionState(
        'accepted',
        'Professor aceitou. Preparando áudio e vídeo…',
        undefined,
        this.sessionState.activeTeacherName,
        undefined,
      );
    });
    socket.on('session:rejected', () => {
      this.updateSessionState(
        'rejected',
        'Professor indisponível. Escolha outro professor.',
        undefined,
        undefined,
        undefined,
      );
    });
    socket.on('session:cancelled', () => {
      this.updateSessionState(
        'cancelled',
        'Solicitação cancelada.',
        undefined,
        undefined,
        undefined,
      );
    });
    socket.on('session:timeout', () => {
      this.updateSessionState('timeout', 'Tempo esgotado', undefined, undefined, undefined);
    });
    socket.on('session:started', (session) => {
      this.remoteControlReceiver.reset();
      this.updateSessionState(
        'connected',
        'Conectado ao professor',
        session.sessionId,
        session.teacherName,
        undefined,
      );
    });
    socket.on('session:ended', (session) => {
      if (this.sessionState.activeSessionId === session.sessionId) {
        this.remoteControlReceiver.endSession(session.sessionId);
        this.updateSessionState('ended', 'Atendimento encerrado', undefined, undefined, undefined);
      }
    });
    socket.on('webrtc:offer', (payload) => {
      for (const listener of this.offerListeners) {
        listener(payload);
      }
    });
    socket.on('webrtc:answer', (payload) => {
      for (const listener of this.answerListeners) {
        listener(payload);
      }
    });
    socket.on('webrtc:ice-candidate', (payload) => {
      for (const listener of this.iceCandidateListeners) {
        listener(payload);
      }
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST, (payload) => {
      this.handleRemoteControlSafely(() => {
        this.remoteControlReceiver.receiveRequest(payload, this.sessionState.activeSessionId);
      });
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, (payload) => {
      this.handleRemoteControlSafely(() => {
        const stopped = this.remoteControlReceiver.receiveMouse(payload);
        if (stopped !== undefined && socket.connected) {
          socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, stopped);
        }
      });
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD, (payload) => {
      this.handleRemoteControlSafely(() => {
        const stopped = this.remoteControlReceiver.receiveKeyboard(payload);
        if (stopped !== undefined && socket.connected) {
          socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, stopped);
        }
      });
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, (payload) => {
      this.remoteControlReceiver.receiveStop(payload);
    });
    socket.connect();
  }

  private startAuthRefresh(socket: StudentPresenceSocket): void {
    this.stopAuthRefresh();
    if (this.authenticatedTransport === undefined) return;
    this.authRefreshTimer = setInterval(() => {
      void this.authenticatedTransport
        ?.getAccessToken()
        .then((token) => {
          if (socket.connected) socket.emit('auth:refresh', { token });
        })
        .catch(() => socket.disconnect());
    }, SOCKET_AUTH_REFRESH_INTERVAL_MS);
    this.authRefreshTimer.unref();
  }

  private stopAuthRefresh(): void {
    if (this.authRefreshTimer !== undefined) clearInterval(this.authRefreshTimer);
    this.authRefreshTimer = undefined;
  }

  public async getOnlineTeachers(): Promise<readonly OnlineTeacher[]> {
    if (this.socket?.connected === true && this.availableTeachers.length > 0) {
      return this.availableTeachers;
    }
    const { serverUrl } = await this.loadConfig();
    const response =
      this.authenticatedTransport === undefined
        ? await fetch(new URL('/api/professors/online', serverUrl))
        : await this.authenticatedTransport.fetch(new URL('/api/professors/online', serverUrl));
    if (!response.ok) {
      throw new Error(`Não foi possível listar professores (${response.status})`);
    }
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || !('professors' in payload)) {
      throw new Error('Resposta inválida ao listar professores');
    }
    const professors = payload.professors;
    if (!Array.isArray(professors)) {
      throw new Error('Resposta inválida ao listar professores');
    }
    this.availableTeachers = professors.filter(isOnlineTeacher);
    return this.availableTeachers;
  }

  public async getHistory(): Promise<readonly AttendanceHistoryItem[]> {
    if (this.authenticatedTransport === undefined) return [];
    const { serverUrl } = await this.loadConfig();
    const response = await this.authenticatedTransport.fetch(
      new URL('/api/sessions/history', serverUrl),
    );
    if (!response.ok) throw new Error(`Não foi possível carregar o histórico (${response.status})`);
    const payload: unknown = await response.json();
    return Array.isArray(payload) ? (payload as AttendanceHistoryItem[]) : [];
  }

  public requestSession(teacherIdInput: string): StudentSessionSnapshot {
    const teacherId = teacherIdInput.trim();
    if (teacherId.length === 0) {
      throw new Error('Selecione um professor online.');
    }
    if (this.socket?.connected !== true) {
      throw new Error('Aluno não está conectado ao servidor.');
    }
    if (this.sessionState.status === 'waiting') {
      return this.getSessionSnapshot();
    }

    this.socket.emit('request:session', { teacherId });
    this.updateSessionState('waiting', 'Aguardando resposta…', undefined, undefined, undefined);
    return this.getSessionSnapshot();
  }

  public cancelRequest(): StudentSessionSnapshot {
    const requestId = this.sessionState.pendingRequestId;
    if (requestId === undefined || this.socket?.connected !== true) {
      throw new Error('Não há solicitação pendente.');
    }
    this.socket.emit('session:cancel', { requestId });
    return this.getSessionSnapshot();
  }

  public getSessionSnapshot(): StudentSessionSnapshot {
    return {
      ...this.sessionState,
      remoteControl: this.remoteControlReceiver.getSnapshot(),
    };
  }

  public endSession(): StudentSessionSnapshot {
    const sessionId = this.sessionState.activeSessionId;
    if (sessionId === undefined || this.socket?.connected !== true) {
      throw new Error('Não há atendimento ativo.');
    }
    this.socket.emit('session:end', { sessionId });
    return this.getSessionSnapshot();
  }

  public reportFileTransfer(entry: FileTransferAuditEntry): void {
    if (entry.direction !== 'sent') return;
    const sessionId = this.sessionState.activeSessionId;
    const socket = this.socket;
    if (sessionId === undefined || socket === undefined || !socket.connected) {
      throw new Error('Sessão ativa necessária para auditar a transferência');
    }
    socket.emit('file-transfer:audit', { ...entry, sessionId });
  }

  public approveRemoteControl(): StudentSessionSnapshot {
    const sessionId = this.requireActiveSessionId();
    const socket = this.requireActiveSignalingSocket(sessionId);
    const approved = this.remoteControlReceiver.approve(sessionId);
    socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, approved);
    return this.getSessionSnapshot();
  }

  public denyRemoteControl(): StudentSessionSnapshot {
    const sessionId = this.requireActiveSessionId();
    const socket = this.requireActiveSignalingSocket(sessionId);
    const denied = this.remoteControlReceiver.deny(sessionId);
    socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, denied);
    return this.getSessionSnapshot();
  }

  public stopRemoteControl(): StudentSessionSnapshot {
    const sessionId = this.requireActiveSessionId();
    const socket = this.requireActiveSignalingSocket(sessionId);
    const stopped = this.remoteControlReceiver.stop(sessionId);
    socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, stopped);
    return this.getSessionSnapshot();
  }

  public onSessionStateChanged(listener: StudentSessionListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  public onAvailableTeachersChanged(listener: AvailableTeachersListener): () => void {
    this.availableTeachersListeners.add(listener);
    return () => this.availableTeachersListeners.delete(listener);
  }

  public sendWebRtcAnswer(payload: WebRtcDescriptionPayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:answer', payload);
  }

  public sendWebRtcOffer(payload: WebRtcDescriptionPayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:offer', payload);
  }

  public sendWebRtcIceCandidate(payload: WebRtcIceCandidatePayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:ice-candidate', payload);
  }

  public onWebRtcOffer(listener: WebRtcDescriptionListener): () => void {
    this.offerListeners.add(listener);
    return () => this.offerListeners.delete(listener);
  }

  public onWebRtcAnswer(listener: WebRtcDescriptionListener): () => void {
    this.answerListeners.add(listener);
    return () => this.answerListeners.delete(listener);
  }

  public sendScreenShareStart(payload: ScreenSharePayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('screen-share:start', payload);
  }

  public sendScreenShareStop(payload: ScreenSharePayload): void {
    const socket = this.requireActiveSignalingSocket(payload.sessionId);
    if (this.remoteControlReceiver.getSnapshot().status !== 'inactive') {
      const stopped = this.remoteControlReceiver.stop(payload.sessionId);
      socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, stopped);
    }
    socket.emit('screen-share:stop', payload);
  }

  public onWebRtcIceCandidate(listener: WebRtcIceCandidateListener): () => void {
    this.iceCandidateListeners.add(listener);
    return () => this.iceCandidateListeners.delete(listener);
  }

  public dispose(): void {
    this.disconnectSocket();
    this.sessionListeners.clear();
    this.availableTeachersListeners.clear();
    this.offerListeners.clear();
    this.answerListeners.clear();
    this.iceCandidateListeners.clear();
    this.unsubscribeRemoteControl();
    this.remoteControlReceiver.dispose();
  }

  public disconnect(): void {
    this.disconnectSocket();
    this.updateSessionState('idle', 'Autenticação necessária.', undefined, undefined, undefined);
  }

  private updateSessionState(
    status: StudentSessionSnapshot['status'],
    message: string,
    activeSessionId = this.sessionState.activeSessionId,
    activeTeacherName = this.sessionState.activeTeacherName,
    pendingRequestId = this.sessionState.pendingRequestId,
  ): void {
    this.sessionState = {
      status,
      message,
      activeSessionId,
      activeTeacherName,
      pendingRequestId,
    };
    this.notifySessionListeners();
  }

  private notifySessionListeners(): void {
    const snapshot = this.getSessionSnapshot();
    for (const listener of this.sessionListeners) {
      listener(snapshot);
    }
  }

  private notifyAvailableTeachersListeners(): void {
    for (const listener of this.availableTeachersListeners) listener(this.availableTeachers);
  }

  private requireActiveSignalingSocket(sessionId: string): StudentPresenceSocket {
    if (this.socket?.connected !== true || this.sessionState.activeSessionId !== sessionId) {
      throw new Error('Sessão WebRTC não está ativa.');
    }
    return this.socket;
  }

  private requireActiveSessionId(): string {
    if (this.sessionState.activeSessionId === undefined) {
      throw new Error('Não há atendimento ativo.');
    }
    return this.sessionState.activeSessionId;
  }

  private handleRemoteControlSafely(action: () => void): void {
    try {
      action();
    } catch (error) {
      remoteControlLogger.error('event-discarded', error);
    }
  }

  private async loadConfig(): Promise<StudentConnectConfig> {
    const content = await readFile(this.configPath, 'utf8');
    const parsed: unknown = JSON.parse(content);

    if (typeof parsed !== 'object' || parsed === null || !('serverUrl' in parsed)) {
      throw new Error('config.json inválido: serverUrl não informado.');
    }

    const serverUrl = parsed.serverUrl;
    if (typeof serverUrl !== 'string') {
      throw new Error('config.json inválido: serverUrl deve ser texto.');
    }

    const url = new URL(serverUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('config.json inválido: serverUrl deve usar HTTP ou HTTPS.');
    }

    return { serverUrl: url.toString() };
  }

  private startHeartbeat(socket: StudentPresenceSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        socket.emit('student:heartbeat');
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private disconnectSocket(): void {
    this.stopHeartbeat();
    const socket = this.socket;

    this.socket = undefined;
    this.remoteControlReceiver.reset();
    if (socket?.connected !== true) {
      socket?.disconnect();
      socket?.removeAllListeners();
      return;
    }

    let disconnectTimer: NodeJS.Timeout | undefined;
    const finishDisconnect = (): void => {
      if (disconnectTimer !== undefined) {
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
      }
      socket.disconnect();
      socket.removeAllListeners();
    };

    disconnectTimer = setTimeout(finishDisconnect, 250);
    socket.emit('student:disconnect', finishDisconnect);
  }
}

function isOnlineTeacher(value: unknown): value is OnlineTeacher {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'status' in value &&
    value.status === 'available' &&
    'availableSince' in value &&
    typeof value.availableSince === 'string'
  );
}
