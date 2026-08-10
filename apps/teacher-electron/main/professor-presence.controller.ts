import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
import { io, type Socket } from 'socket.io-client';
import type { FileTransferAuditEntry } from '@professor-connect/engine/file-transfer-node';
import type {
  SessionRecoveryStore,
  StoredSessionRecovery,
} from '@professor-connect/shared/electron';
import { ReconnectService } from '@professor-connect/shared';

import {
  ProfessorPresenceStatus,
  type AttendanceHistoryItem,
  type ProfessorActiveSession,
  type ProfessorSessionRequest,
  type ProfessorPresenceSnapshot,
  type OperationalStudentPresence,
} from '../shared/presence-contracts.js';
import type {
  RemoteControlLogEntry,
  TeacherRemoteControlSnapshot,
} from '../shared/remote-control-contracts.js';
import type {
  WebRtcDescriptionListener,
  WebRtcDescriptionPayload,
  WebRtcIceCandidateListener,
  WebRtcIceCandidatePayload,
  ScreenShareListener,
  ScreenSharePayload,
} from '../shared/webrtc-contracts.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const SESSION_REQUEST_TIMEOUT_MS = 30_000;
const MAXIMUM_REMOTE_CONTROL_LOG_ENTRIES = 100;
const SOCKET_AUTH_REFRESH_INTERVAL_MS = 60_000;

interface ProfessorPresenceClientEvents {
  'auth:refresh': (
    payload: { readonly token: string },
    acknowledge?: (result: { readonly ok: boolean }) => void,
  ) => void;
  'file-transfer:audit': (payload: FileTransferAuditEntry & { readonly sessionId: string }) => void;
  'professor:heartbeat': (acknowledge?: (payload: { readonly serverTime: string }) => void) => void;
  'professor:online': (payload: { readonly name: string }) => void;
  'professor:availability:set': (
    payload: { readonly available: boolean },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:queue:get': () => void;
  'students:presence:get': () => void;
  'session:end': (payload: { readonly sessionId: string; readonly recoveryToken?: string }) => void;
  'session:recover': (
    payload: { readonly sessionId: string; readonly recoveryToken: string },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST]: (payload: RemoteControlRequest) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE]: (payload: RemoteControlMousePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD]: (payload: RemoteControlKeyboardPayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface ProfessorPresenceServerEvents {
  'professor:availability:changed': (payload: {
    readonly available: boolean;
    readonly availableSince?: string;
  }) => void;
  'session:requested': (payload: ProfessorSessionRequest) => void;
  'session:queue:changed': (payload: TeacherQueuePayload) => void;
  'students:presence:changed': (payload: readonly OperationalStudentPresence[]) => void;
  'session:timeout': (payload: SessionRequestTimeoutPayload) => void;
  'session:cancelled': (payload: SessionRequestTimeoutPayload) => void;
  'session:started': (payload: ProfessorActiveSession) => void;
  'session:ended': (payload: ProfessorActiveSession) => void;
  'session:reconnecting': (payload: ProfessorActiveSession) => void;
  'session:recovered': (payload: ProfessorActiveSession) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'screen-share:start': (payload: ScreenSharePayload) => void;
  'screen-share:stop': (payload: ScreenSharePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED]: (payload: RemoteControlApproved) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.DENIED]: (payload: RemoteControlDenied) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface ProfessorConnectConfig {
  readonly serverUrl: string;
  readonly reconnectAttempts?: number;
  readonly reconnectDelayMs?: number;
  readonly reconnectDelayMaxMs?: number;
  readonly connectTimeoutMs?: number;
}

interface SessionRequestTimeoutPayload {
  readonly requestId: string;
}

interface TeacherQueuePayload {
  readonly teacherId: string;
  readonly totalWaiting: number;
  readonly requests: readonly ProfessorSessionRequest[];
}

type PresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;
type PresenceSocket = Socket<ProfessorPresenceServerEvents, ProfessorPresenceClientEvents>;

export interface AuthenticatedTransport {
  getAccessToken(): Promise<string>;
  fetch(input: URL | string, init?: RequestInit): Promise<Response>;
}

export class ProfessorPresenceController {
  private connectionGeneration = 0;
  private readonly listeners = new Set<PresenceListener>();
  private readonly answerListeners = new Set<WebRtcDescriptionListener>();
  private readonly offerListeners = new Set<WebRtcDescriptionListener>();
  private readonly iceCandidateListeners = new Set<WebRtcIceCandidateListener>();
  private readonly screenShareStartedListeners = new Set<ScreenShareListener>();
  private readonly screenShareStoppedListeners = new Set<ScreenShareListener>();
  private readonly sessionRequestExpirationTimers = new Map<string, NodeJS.Timeout>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private authRefreshTimer: NodeJS.Timeout | undefined;
  private professorName: string | undefined;
  private sessionRequests: ProfessorSessionRequest[] = [];
  private onlineStudents: OperationalStudentPresence[] = [];
  private activeSession: ProfessorActiveSession | undefined;
  private sessionNotice: string | undefined;
  private socket: PresenceSocket | undefined;
  private status = ProfessorPresenceStatus.DISCONNECTED;
  private available = false;
  private availableSince: string | undefined;
  private remoteControl = createInitialRemoteControlSnapshot();
  private storedRecovery: StoredSessionRecovery | undefined;
  private startupRecoveryPending = false;
  private latencyMs: number | undefined;

  public constructor(
    private readonly configPath: string,
    _sessionRequestTimeoutMs = SESSION_REQUEST_TIMEOUT_MS,
    private readonly authenticatedTransport?: AuthenticatedTransport,
    private readonly recoveryStore?: SessionRecoveryStore,
  ) {
    void _sessionRequestTimeoutMs;
  }

  public async connect(nameInput: string): Promise<ProfessorPresenceSnapshot> {
    const name = nameInput.trim();

    if (name.length === 0) {
      throw new Error('Informe o nome do professor.');
    }

    const connectionGeneration = ++this.connectionGeneration;

    this.disconnectSocket();
    this.professorName = name;
    this.status = ProfessorPresenceStatus.CONNECTING;
    this.notifyListeners();

    this.storedRecovery = await this.recoveryStore?.load();
    this.startupRecoveryPending = this.storedRecovery !== undefined;

    let config: ProfessorConnectConfig;
    try {
      config = await this.loadConfig();
    } catch (error) {
      if (connectionGeneration === this.connectionGeneration) {
        this.professorName = undefined;
        this.status = ProfessorPresenceStatus.ERROR;
        this.notifyListeners();
      }
      throw error;
    }

    if (connectionGeneration !== this.connectionGeneration) {
      return this.getSnapshot();
    }

    const { serverUrl } = config;
    const reconnect = new ReconnectService(config).settings;
    const accessToken = await this.authenticatedTransport?.getAccessToken();
    const socket: PresenceSocket = io(serverUrl, {
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
      this.status = this.startupRecoveryPending
        ? ProfessorPresenceStatus.RECOVERY_AVAILABLE
        : ProfessorPresenceStatus.CONNECTED;
      socket.emit('professor:online', { name });
      socket.emit('session:queue:get');
      socket.emit('students:presence:get');
      this.startHeartbeat(socket);
      this.startAuthRefresh(socket);
      if (!this.startupRecoveryPending) this.recoverCurrentSession(socket);
      this.notifyListeners();
    });
    socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.status =
        this.activeSession === undefined
          ? ProfessorPresenceStatus.DISCONNECTED
          : ProfessorPresenceStatus.RECONNECTING;
      if (this.activeSession !== undefined) {
        this.sessionNotice = 'Conexão perdida. Tentando reconectar…';
      }
      this.notifyListeners();
    });
    socket.on('connect_error', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.status =
        this.activeSession === undefined
          ? ProfessorPresenceStatus.ERROR
          : ProfessorPresenceStatus.RECONNECTING;
      this.notifyListeners();
    });
    socket.on('professor:availability:changed', (payload) => {
      this.available = payload.available;
      this.availableSince = payload.availableSince;
      this.notifyListeners();
    });
    socket.on('session:requested', (request) => {
      if (this.sessionRequests.some((item) => item.requestId === request.requestId)) {
        return;
      }
      this.sessionRequests = [...this.sessionRequests, request];
      this.sessionNotice = undefined;
      this.notifyListeners();
    });
    socket.on('session:queue:changed', (payload) => {
      this.clearSessionRequestExpirationTimers();
      this.sessionRequests = [...payload.requests].sort(
        (left, right) => left.position - right.position,
      );
      this.notifyListeners();
    });
    socket.on('students:presence:changed', (payload) => {
      this.onlineStudents = [...payload];
      this.notifyListeners();
    });
    socket.on('session:timeout', (payload) => {
      this.expireSessionRequest(payload.requestId);
    });
    socket.on('session:cancelled', (payload) => {
      this.clearSessionRequestExpirationTimer(payload.requestId);
      this.sessionRequests = this.sessionRequests.filter(
        (request) => request.requestId !== payload.requestId,
      );
      this.sessionNotice = 'O aluno cancelou a solicitação.';
      this.notifyListeners();
    });
    socket.on('session:started', (session) => {
      if (session.requestId !== undefined)
        this.clearSessionRequestExpirationTimer(session.requestId);
      this.sessionRequests = this.sessionRequests.filter(
        (request) =>
          request.requestId !== session.requestId && request.studentId !== session.studentId,
      );
      this.activeSession = session;
      this.sessionNotice = undefined;
      this.remoteControl = createInitialRemoteControlSnapshot();
      this.saveRecovery(session);
      this.notifyListeners();
    });
    socket.on('session:reconnecting', (session) => {
      if (this.activeSession?.sessionId !== session.sessionId) return;
      this.status = ProfessorPresenceStatus.RECOVERING;
      this.sessionNotice = 'O aluno perdeu a conexão. Aguardando recuperação…';
      this.notifyListeners();
    });
    socket.on('session:recovered', (session) => {
      if (
        this.storedRecovery?.sessionId !== session.sessionId &&
        this.activeSession?.sessionId !== session.sessionId
      )
        return;
      this.activeSession = session;
      this.status =
        session.state === 'CONNECTED'
          ? ProfessorPresenceStatus.CONNECTED
          : ProfessorPresenceStatus.RECOVERING;
      this.sessionNotice =
        session.state === 'CONNECTED'
          ? 'Sessão recuperada. Reconectando áudio e vídeo…'
          : 'Sua conexão voltou. Aguardando o aluno…';
      if (session.recoveryToken !== undefined) this.saveRecovery(session);
      this.notifyListeners();
    });
    socket.on('session:ended', (session) => {
      if (this.activeSession?.sessionId === session.sessionId) {
        this.finishRemoteControlLocally(session.sessionId);
        this.activeSession = undefined;
        this.sessionNotice = 'Atendimento encerrado.';
        void this.clearRecovery();
        this.notifyListeners();
      }
    });
    socket.on('webrtc:answer', (payload) => {
      for (const listener of this.answerListeners) {
        listener(payload);
      }
    });
    socket.on('webrtc:offer', (payload) => {
      for (const listener of this.offerListeners) {
        listener(payload);
      }
    });
    socket.on('webrtc:ice-candidate', (payload) => {
      for (const listener of this.iceCandidateListeners) {
        listener(payload);
      }
    });
    socket.on('screen-share:start', (payload) => {
      for (const listener of this.screenShareStartedListeners) {
        listener(payload);
      }
    });
    socket.on('screen-share:stop', (payload) => {
      for (const listener of this.screenShareStoppedListeners) {
        listener(payload);
      }
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.APPROVED, (payload) => {
      if (!this.matchesRemoteControl(payload, 'pending')) {
        return;
      }
      this.remoteControl = {
        ...this.remoteControl,
        status: 'active',
        logs: this.appendRemoteControlLog('Solicitação aceita'),
      };
      this.notifyListeners();
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.DENIED, (payload) => {
      if (!this.matchesRemoteControl(payload, 'pending')) {
        return;
      }
      this.remoteControl = {
        status: 'inactive',
        sessionId: undefined,
        requestId: undefined,
        logs: this.appendRemoteControlLog('Solicitação negada'),
      };
      this.notifyListeners();
    });
    socket.on(REMOTE_CONTROL_CHANNEL_EVENTS.STOP, (payload) => {
      if (this.matchesRemoteControl(payload)) {
        this.finishRemoteControlLocally(payload.sessionId, payload.reason);
        this.notifyListeners();
      }
    });
    socket.io.on('reconnect_attempt', (attempt) => {
      if (this.activeSession !== undefined) {
        this.status = ProfessorPresenceStatus.RECONNECTING;
        this.sessionNotice = `Reconectando… tentativa ${attempt} de ${reconnect.attempts}`;
        this.notifyListeners();
      }
    });
    socket.io.on('reconnect_failed', () => {
      if (this.activeSession !== undefined) {
        this.status = ProfessorPresenceStatus.DISCONNECTED;
        this.sessionNotice = 'Não foi possível reconectar automaticamente. Verifique sua internet.';
        this.notifyListeners();
      }
    });
    socket.connect();

    return this.getSnapshot();
  }

  private startAuthRefresh(socket: PresenceSocket): void {
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

  public disconnect(): ProfessorPresenceSnapshot {
    this.connectionGeneration += 1;
    this.disconnectSocket();
    this.professorName = undefined;
    this.status = ProfessorPresenceStatus.DISCONNECTED;
    void this.clearRecovery();
    this.notifyListeners();
    return this.getSnapshot();
  }

  public getSnapshot(): ProfessorPresenceSnapshot {
    return {
      professorName: this.professorName,
      status: this.status,
      serverConnected: this.status === ProfessorPresenceStatus.CONNECTED,
      available: this.available,
      availableSince: this.availableSince,
      sessionRequests: [...this.sessionRequests],
      onlineStudents: [...this.onlineStudents],
      activeSession: this.activeSession,
      sessionNotice: this.sessionNotice,
      remoteControl: { ...this.remoteControl, logs: [...this.remoteControl.logs] },
      latencyMs: this.latencyMs,
      ...(this.startupRecoveryPending && this.storedRecovery !== undefined
        ? {
            recoverableSession: {
              sessionId: this.storedRecovery.sessionId,
              studentName: this.storedRecovery.peerName,
              ...(this.storedRecovery.recoveryDeadline === undefined
                ? {}
                : { recoveryDeadline: this.storedRecovery.recoveryDeadline }),
            },
          }
        : {}),
    };
  }

  public acceptSession(requestId: string): ProfessorPresenceSnapshot {
    return this.respondToSession('session:accept', requestId);
  }

  public async setAvailability(available: boolean): Promise<ProfessorPresenceSnapshot> {
    const socket = this.socket;
    if (socket?.connected !== true || this.activeSession !== undefined) {
      throw new Error('Não é possível alterar a disponibilidade agora.');
    }
    await new Promise<void>((resolve, reject) => {
      socket.emit('professor:availability:set', { available }, (result) => {
        if (result.ok) resolve();
        else reject(new Error(result.message ?? 'Não foi possível alterar a disponibilidade.'));
      });
    });
    return this.getSnapshot();
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

  public rejectSession(requestId: string): ProfessorPresenceSnapshot {
    return this.respondToSession('session:reject', requestId);
  }

  public endSession(): ProfessorPresenceSnapshot {
    if (this.activeSession === undefined || this.socket?.connected !== true) {
      throw new Error('Não há atendimento ativo.');
    }
    this.socket.emit('session:end', { sessionId: this.activeSession.sessionId });
    return this.getSnapshot();
  }

  public resumeSession(): ProfessorPresenceSnapshot {
    if (this.storedRecovery === undefined || this.socket?.connected !== true) {
      throw new Error('Nenhuma sessão pode ser retomada agora.');
    }
    this.startupRecoveryPending = false;
    this.status = ProfessorPresenceStatus.RECOVERING;
    this.sessionNotice = 'Recuperando atendimento…';
    this.recoverCurrentSession(this.socket);
    this.notifyListeners();
    return this.getSnapshot();
  }

  public discardRecovery(): ProfessorPresenceSnapshot {
    if (this.socket?.connected === true && this.storedRecovery !== undefined) {
      this.socket.emit('session:end', {
        sessionId: this.storedRecovery.sessionId,
        recoveryToken: this.storedRecovery.recoveryToken,
      });
    }
    this.startupRecoveryPending = false;
    void this.clearRecovery();
    this.status = ProfessorPresenceStatus.CONNECTED;
    this.sessionNotice = 'Atendimento anterior encerrado.';
    this.notifyListeners();
    return this.getSnapshot();
  }

  public requestRemoteControl(): ProfessorPresenceSnapshot {
    const session = this.requireActiveSession();
    if (this.remoteControl.status !== 'inactive') {
      throw new Error('Já existe uma solicitação de controle remoto');
    }
    const request: RemoteControlRequest = {
      sessionId: session.sessionId,
      requestId: randomUUID(),
    };
    this.requireActiveSignalingSocket(session.sessionId).emit(
      REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST,
      request,
    );
    this.remoteControl = {
      status: 'pending',
      sessionId: request.sessionId,
      requestId: request.requestId,
      logs: this.appendRemoteControlLog('Solicitação enviada'),
    };
    this.notifyListeners();
    return this.getSnapshot();
  }

  public sendRemoteControlMouse(event: RemoteControlMouseEvent): void {
    const reference = this.requireActiveRemoteControl();
    const socket = this.requireActiveSignalingSocket(reference.sessionId);
    const payload = { ...reference, event };
    if (event.type === 'mousemove') {
      socket.volatile.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, payload);
      return;
    }
    socket.emit(REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE, payload);
  }

  public sendRemoteControlKeyboard(event: RemoteControlKeyboardEvent): void {
    const reference = this.requireActiveRemoteControl();
    this.requireActiveSignalingSocket(reference.sessionId).emit(
      REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD,
      { ...reference, event },
    );
  }

  public reportFileTransfer(entry: FileTransferAuditEntry): void {
    if (entry.direction !== 'sent') return;
    const session = this.activeSession;
    const socket = this.socket;
    if (session === undefined || socket === undefined || !socket.connected) {
      throw new Error('Sessão ativa necessária para auditar a transferência');
    }
    socket.emit('file-transfer:audit', { ...entry, sessionId: session.sessionId });
  }

  public stopRemoteControl(): ProfessorPresenceSnapshot {
    const reference = this.requireRemoteControlReference();
    this.requireActiveSignalingSocket(reference.sessionId).emit(
      REMOTE_CONTROL_CHANNEL_EVENTS.STOP,
      { ...reference, reason: 'participant' },
    );
    this.finishRemoteControlLocally(reference.sessionId);
    this.notifyListeners();
    return this.getSnapshot();
  }

  public onStateChanged(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public sendWebRtcOffer(payload: WebRtcDescriptionPayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:offer', payload);
  }

  public sendWebRtcAnswer(payload: WebRtcDescriptionPayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:answer', payload);
  }

  public sendWebRtcIceCandidate(payload: WebRtcIceCandidatePayload): void {
    this.requireActiveSignalingSocket(payload.sessionId).emit('webrtc:ice-candidate', payload);
  }

  public onWebRtcAnswer(listener: WebRtcDescriptionListener): () => void {
    this.answerListeners.add(listener);
    return () => this.answerListeners.delete(listener);
  }

  public onWebRtcOffer(listener: WebRtcDescriptionListener): () => void {
    this.offerListeners.add(listener);
    return () => this.offerListeners.delete(listener);
  }

  public onScreenShareStarted(listener: ScreenShareListener): () => void {
    this.screenShareStartedListeners.add(listener);
    return () => this.screenShareStartedListeners.delete(listener);
  }

  public onScreenShareStopped(listener: ScreenShareListener): () => void {
    this.screenShareStoppedListeners.add(listener);
    return () => this.screenShareStoppedListeners.delete(listener);
  }

  public onWebRtcIceCandidate(listener: WebRtcIceCandidateListener): () => void {
    this.iceCandidateListeners.add(listener);
    return () => this.iceCandidateListeners.delete(listener);
  }

  public dispose(): void {
    this.connectionGeneration += 1;
    this.disconnectSocket();
    this.listeners.clear();
    this.answerListeners.clear();
    this.offerListeners.clear();
    this.iceCandidateListeners.clear();
    this.screenShareStartedListeners.clear();
    this.screenShareStoppedListeners.clear();
  }

  private async loadConfig(): Promise<ProfessorConnectConfig> {
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

  private startHeartbeat(socket: PresenceSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        const sentAt = Date.now();
        socket.emit('professor:heartbeat', () => {
          this.latencyMs = Math.max(0, Date.now() - sentAt);
          this.notifyListeners();
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private disconnectSocket(): void {
    this.stopHeartbeat();
    this.clearSessionRequestExpirationTimers();
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = undefined;
    this.available = false;
    this.availableSince = undefined;
    this.sessionRequests = [];
    this.onlineStudents = [];
    this.activeSession = undefined;
    this.sessionNotice = undefined;
    this.remoteControl = createInitialRemoteControlSnapshot();
  }

  private recoverCurrentSession(socket: PresenceSocket): void {
    const recovery = this.storedRecovery;
    if (recovery === undefined || !socket.connected) return;
    socket.emit(
      'session:recover',
      { sessionId: recovery.sessionId, recoveryToken: recovery.recoveryToken },
      (result) => {
        if (!result.ok) {
          this.status = ProfessorPresenceStatus.DISCONNECTED;
          this.sessionNotice = result.message ?? 'Não foi possível recuperar a sessão.';
          void this.clearRecovery();
          this.notifyListeners();
        }
      },
    );
  }

  private saveRecovery(session: ProfessorActiveSession): void {
    if (session.recoveryToken === undefined) return;
    const recovery: StoredSessionRecovery = {
      sessionId: session.sessionId,
      recoveryToken: session.recoveryToken,
      peerName: session.studentName,
      savedAt: new Date().toISOString(),
      teacherId: session.teacherId,
      teacherName: session.teacherName,
      studentId: session.studentId,
      studentName: session.studentName,
      ...(session.recoveryDeadline === undefined
        ? {}
        : { recoveryDeadline: session.recoveryDeadline }),
    };
    this.storedRecovery = recovery;
    void this.recoveryStore?.save(recovery);
  }

  private async clearRecovery(): Promise<void> {
    this.storedRecovery = undefined;
    await this.recoveryStore?.clear();
  }

  private respondToSession(
    event: 'session:accept' | 'session:reject',
    requestIdInput: string,
  ): ProfessorPresenceSnapshot {
    const requestId = requestIdInput.trim();
    if (requestId.length === 0) {
      throw new Error('Identificador da solicitação inválido.');
    }
    if (this.socket?.connected !== true) {
      throw new Error('Professor não está conectado ao servidor.');
    }
    if (!this.sessionRequests.some((request) => request.requestId === requestId)) {
      throw new Error('Solicitação não encontrada.');
    }

    this.socket.emit(event, { requestId });
    if (event === 'session:reject') {
      this.clearSessionRequestExpirationTimer(requestId);
      this.sessionRequests = this.sessionRequests.filter(
        (request) => request.requestId !== requestId,
      );
    }
    this.notifyListeners();
    return this.getSnapshot();
  }

  private expireSessionRequest(requestId: string): void {
    const hasRequest = this.sessionRequests.some((request) => request.requestId === requestId);
    this.clearSessionRequestExpirationTimer(requestId);
    if (!hasRequest) {
      return;
    }
    this.sessionRequests = this.sessionRequests.filter(
      (request) => request.requestId !== requestId,
    );
    this.sessionNotice = 'A solicitação expirou. Peça ao aluno para enviar novamente.';
    this.notifyListeners();
  }

  private clearSessionRequestExpirationTimer(requestId: string): void {
    const timer = this.sessionRequestExpirationTimers.get(requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.sessionRequestExpirationTimers.delete(requestId);
    }
  }

  private clearSessionRequestExpirationTimers(): void {
    for (const timer of this.sessionRequestExpirationTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionRequestExpirationTimers.clear();
  }

  private requireActiveSignalingSocket(sessionId: string): PresenceSocket {
    if (this.socket?.connected !== true || this.activeSession?.sessionId !== sessionId) {
      throw new Error('Sessão WebRTC não está ativa.');
    }
    return this.socket;
  }

  private requireActiveSession(): ProfessorActiveSession {
    if (this.activeSession === undefined || this.socket?.connected !== true) {
      throw new Error('Não há atendimento ativo.');
    }
    return this.activeSession;
  }

  private requireActiveRemoteControl(): RemoteControlRequest {
    if (this.remoteControl.status !== 'active') {
      throw new Error('Controle remoto não está autorizado');
    }
    return this.requireRemoteControlReference();
  }

  private requireRemoteControlReference(): RemoteControlRequest {
    const { sessionId, requestId } = this.remoteControl;
    if (
      sessionId === undefined ||
      requestId === undefined ||
      sessionId !== this.activeSession?.sessionId
    ) {
      throw new Error('Controle remoto não pertence à sessão ativa');
    }
    return { sessionId, requestId };
  }

  private matchesRemoteControl(
    reference: RemoteControlRequest,
    expectedStatus?: TeacherRemoteControlSnapshot['status'],
  ): boolean {
    return (
      this.remoteControl.sessionId === reference.sessionId &&
      this.remoteControl.requestId === reference.requestId &&
      (expectedStatus === undefined || this.remoteControl.status === expectedStatus)
    );
  }

  private finishRemoteControlLocally(
    sessionId: string,
    reason?: RemoteControlStopPayload['reason'],
  ): void {
    if (this.remoteControl.sessionId !== sessionId) {
      return;
    }
    this.remoteControl = {
      status: 'inactive',
      sessionId: undefined,
      requestId: undefined,
      logs: this.appendRemoteControlLog(
        reason === undefined ? 'Controle encerrado' : `Controle encerrado: ${reason}`,
      ),
    };
  }

  private appendRemoteControlLog(message: string): readonly RemoteControlLogEntry[] {
    return [
      ...this.remoteControl.logs,
      {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        message,
      },
    ].slice(-MAXIMUM_REMOTE_CONTROL_LOG_ENTRIES);
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function createInitialRemoteControlSnapshot(): TeacherRemoteControlSnapshot {
  return {
    status: 'inactive',
    sessionId: undefined,
    requestId: undefined,
    logs: [],
  };
}

function readOptionalReconnectConfig(value: object): Omit<ProfessorConnectConfig, 'serverUrl'> {
  const record = value as Record<string, unknown>;
  const result: Omit<ProfessorConnectConfig, 'serverUrl'> = {};
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
