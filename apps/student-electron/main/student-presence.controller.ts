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
  SessionRecoveryStore,
  StoredSessionRecovery,
} from '@professor-connect/shared/electron';
import { ReconnectService } from '@professor-connect/shared';

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
  'student:heartbeat': (acknowledge?: (payload: { readonly serverTime: string }) => void) => void;
  'student:register': (payload: StudentIdentity) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
  'session:cancel': (payload: { readonly requestId: string }) => void;
  'professor:availability:get': () => void;
  'session:end': (payload: { readonly sessionId: string; readonly recoveryToken?: string }) => void;
  'session:recover': (
    payload: { readonly sessionId: string; readonly recoveryToken: string },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
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
  'session:reconnecting': (payload: SessionLifecyclePayload) => void;
  'session:recovered': (payload: SessionLifecyclePayload) => void;
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
  readonly state?: 'CONNECTED' | 'RECONNECTING' | 'RECOVERING' | 'FINISHED';
  readonly recoveryDeadline?: string;
  readonly recoveryToken?: string;
}

interface StudentConnectConfig {
  readonly serverUrl: string;
  readonly reconnectAttempts?: number;
  readonly reconnectDelayMs?: number;
  readonly reconnectDelayMaxMs?: number;
  readonly connectTimeoutMs?: number;
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
  private storedRecovery: StoredSessionRecovery | undefined;
  private startupRecoveryPending = false;
  private latencyMs: number | undefined;
  private sessionState: Omit<StudentSessionSnapshot, 'remoteControl' | 'latencyMs'> = {
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
    private readonly recoveryStore?: SessionRecoveryStore,
  ) {
    this.remoteControlReceiver = remoteControlReceiver;
    this.unsubscribeRemoteControl = this.remoteControlReceiver.onStateChanged(() => {
      this.notifySessionListeners();
    });
  }

  public async connect(): Promise<void> {
    this.disconnectSocket();

    if (this.sessionState.activeSessionId === undefined) {
      this.storedRecovery = await this.recoveryStore?.load();
      if (this.storedRecovery !== undefined) {
        this.startupRecoveryPending = true;
        this.updateSessionState(
          'recovery-available',
          `Há um atendimento interrompido com ${this.storedRecovery.peerName}.`,
          this.storedRecovery.sessionId,
          this.storedRecovery.peerName,
          undefined,
          this.storedRecovery.recoveryDeadline,
        );
      }
    }

    const config = await this.loadConfig();
    const { serverUrl } = config;
    const reconnect = new ReconnectService(config).settings;
    const accessToken = await this.authenticatedTransport?.getAccessToken();
    const socket: StudentPresenceSocket = io(serverUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: reconnect.attempts,
      reconnectionDelay: reconnect.initialDelayMs,
      reconnectionDelayMax: reconnect.maximumDelayMs,
      timeout: reconnect.connectTimeoutMs,
      ...(accessToken === undefined ? {} : { auth: { token: accessToken } }),
    });

    this.socket = socket;
    socket.on('connect', () => {
      socket.emit('student:register', this.identity);
      socket.emit('professor:availability:get');
      this.startHeartbeat(socket);
      this.startAuthRefresh(socket);
      if (!this.startupRecoveryPending) this.recoverCurrentSession(socket);
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
      if (this.sessionState.activeSessionId !== undefined) {
        this.updateSessionState('reconnecting', 'Conexão perdida. Tentando reconectar…');
      }
    });
    socket.on('connect_error', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.remoteControlReceiver.handleTransportLoss();
      if (this.sessionState.activeSessionId !== undefined) {
        this.updateSessionState(
          'reconnecting',
          'Servidor indisponível. Nova tentativa em instantes…',
        );
      }
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
      this.saveRecovery(session);
    });
    socket.on('session:reconnecting', (session) => {
      if (this.sessionState.activeSessionId === session.sessionId) {
        this.updateSessionState(
          'recovering',
          'O professor perdeu a conexão. Aguardando recuperação…',
          session.sessionId,
          session.teacherName,
          undefined,
          session.recoveryDeadline,
        );
      }
    });
    socket.on('session:recovered', (session) => {
      if (this.sessionState.activeSessionId !== session.sessionId) return;
      if (session.recoveryToken !== undefined) this.saveRecovery(session);
      this.remoteControlReceiver.handleTransportRestored();
      this.updateSessionState(
        session.state === 'CONNECTED' ? 'connected' : 'recovering',
        session.state === 'CONNECTED'
          ? 'Sessão recuperada. Reconectando áudio e vídeo…'
          : 'Sua conexão voltou. Aguardando o professor…',
        session.sessionId,
        session.teacherName,
        undefined,
        session.recoveryDeadline,
      );
    });
    socket.on('session:ended', (session) => {
      if (this.sessionState.activeSessionId === session.sessionId) {
        this.remoteControlReceiver.endSession(session.sessionId);
        this.updateSessionState('ended', 'Atendimento encerrado', undefined, undefined, undefined);
        void this.clearRecovery();
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
    socket.io.on('reconnect_attempt', (attempt) => {
      if (this.sessionState.activeSessionId !== undefined) {
        this.updateSessionState(
          'reconnecting',
          `Reconectando… tentativa ${attempt} de ${reconnect.attempts}`,
        );
      }
    });
    socket.io.on('reconnect_failed', () => {
      if (this.sessionState.activeSessionId !== undefined) {
        this.updateSessionState(
          'disconnected',
          'Não foi possível reconectar automaticamente. Verifique sua internet.',
        );
      }
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
      latencyMs: this.latencyMs,
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

  public resumeSession(): StudentSessionSnapshot {
    if (this.storedRecovery === undefined || this.socket?.connected !== true) {
      throw new Error('Nenhuma sessão pode ser retomada agora.');
    }
    this.startupRecoveryPending = false;
    this.updateSessionState('recovering', 'Recuperando atendimento…');
    this.recoverCurrentSession(this.socket);
    return this.getSessionSnapshot();
  }

  public discardRecovery(): StudentSessionSnapshot {
    if (this.socket?.connected === true && this.storedRecovery !== undefined) {
      this.socket.emit('session:end', {
        sessionId: this.storedRecovery.sessionId,
        recoveryToken: this.storedRecovery.recoveryToken,
      });
    }
    this.startupRecoveryPending = false;
    void this.clearRecovery();
    this.updateSessionState(
      'ended',
      'Atendimento anterior encerrado.',
      undefined,
      undefined,
      undefined,
    );
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
    void this.clearRecovery();
  }

  private updateSessionState(
    status: StudentSessionSnapshot['status'],
    message: string,
    activeSessionId = this.sessionState.activeSessionId,
    activeTeacherName = this.sessionState.activeTeacherName,
    pendingRequestId = this.sessionState.pendingRequestId,
    recoveryDeadline?: string,
  ): void {
    this.sessionState = {
      status,
      message,
      activeSessionId,
      activeTeacherName,
      pendingRequestId,
      ...(recoveryDeadline === undefined ? {} : { recoveryDeadline }),
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

    return { serverUrl: url.toString(), ...readOptionalReconnectConfig(parsed) };
  }

  private startHeartbeat(socket: StudentPresenceSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        const sentAt = Date.now();
        socket.emit('student:heartbeat', () => {
          this.latencyMs = Math.max(0, Date.now() - sentAt);
          this.notifySessionListeners();
        });
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

  private recoverCurrentSession(socket: StudentPresenceSocket): void {
    const recovery = this.storedRecovery;
    if (recovery === undefined || !socket.connected) return;
    socket.emit(
      'session:recover',
      { sessionId: recovery.sessionId, recoveryToken: recovery.recoveryToken },
      (result) => {
        if (!result.ok) {
          this.updateSessionState(
            'disconnected',
            result.message ?? 'Não foi possível recuperar a sessão.',
          );
          void this.clearRecovery();
        }
      },
    );
  }

  private saveRecovery(session: SessionLifecyclePayload): void {
    if (session.recoveryToken === undefined) return;
    const recovery: StoredSessionRecovery = {
      sessionId: session.sessionId,
      recoveryToken: session.recoveryToken,
      peerName: session.teacherName,
      savedAt: new Date().toISOString(),
      ...(session.recoveryDeadline === undefined
        ? {}
        : { recoveryDeadline: session.recoveryDeadline }),
    };
    this.storedRecovery = recovery;
    void this.recoveryStore?.save(recovery).catch((error: unknown) => {
      remoteControlLogger.error('recovery-token-save-failed', error);
    });
  }

  private async clearRecovery(): Promise<void> {
    this.storedRecovery = undefined;
    await this.recoveryStore?.clear();
  }
}

function readOptionalReconnectConfig(value: object): Omit<StudentConnectConfig, 'serverUrl'> {
  const record = value as Record<string, unknown>;
  const result: Omit<StudentConnectConfig, 'serverUrl'> = {};
  for (const key of [
    'reconnectAttempts',
    'reconnectDelayMs',
    'reconnectDelayMaxMs',
    'connectTimeoutMs',
  ] as const) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
      Object.assign(result, { [key]: candidate });
    }
  }
  return result;
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
