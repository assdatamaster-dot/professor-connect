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

import {
  ProfessorPresenceStatus,
  type ProfessorActiveSession,
  type ProfessorSessionRequest,
  type ProfessorPresenceSnapshot,
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
  'professor:heartbeat': () => void;
  'professor:online': (payload: { readonly name: string }) => void;
  'session:accept': (payload: { readonly requestId: string }) => void;
  'session:reject': (payload: { readonly requestId: string }) => void;
  'session:end': (payload: { readonly sessionId: string }) => void;
  'webrtc:offer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:answer': (payload: WebRtcDescriptionPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.REQUEST]: (payload: RemoteControlRequest) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE]: (payload: RemoteControlMousePayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.KEYBOARD]: (payload: RemoteControlKeyboardPayload) => void;
  [REMOTE_CONTROL_CHANNEL_EVENTS.STOP]: (payload: RemoteControlStopPayload) => void;
}

interface ProfessorPresenceServerEvents {
  'session:requested': (payload: ProfessorSessionRequest) => void;
  'session:timeout': (payload: SessionRequestTimeoutPayload) => void;
  'session:started': (payload: ProfessorActiveSession) => void;
  'session:ended': (payload: ProfessorActiveSession) => void;
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
}

interface SessionRequestTimeoutPayload {
  readonly requestId: string;
}

type PresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;
type PresenceSocket = Socket<ProfessorPresenceServerEvents, ProfessorPresenceClientEvents>;

export interface AuthenticatedTransport {
  getAccessToken(): Promise<string>;
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
  private activeSession: ProfessorActiveSession | undefined;
  private sessionNotice: string | undefined;
  private socket: PresenceSocket | undefined;
  private status = ProfessorPresenceStatus.DISCONNECTED;
  private remoteControl = createInitialRemoteControlSnapshot();

  public constructor(
    private readonly configPath: string,
    private readonly sessionRequestTimeoutMs = SESSION_REQUEST_TIMEOUT_MS,
    private readonly authenticatedTransport?: AuthenticatedTransport,
  ) {}

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
    const accessToken = await this.authenticatedTransport?.getAccessToken();
    const socket: PresenceSocket = io(serverUrl, {
      autoConnect: false,
      ...(accessToken === undefined ? {} : { auth: { token: accessToken } }),
    });

    this.socket = socket;
    socket.on('connect', () => {
      this.status = ProfessorPresenceStatus.CONNECTED;
      socket.emit('professor:online', { name });
      this.startHeartbeat(socket);
      this.startAuthRefresh(socket);
      this.notifyListeners();
    });
    socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.status = ProfessorPresenceStatus.DISCONNECTED;
      const remoteSessionId = this.remoteControl.sessionId;
      if (remoteSessionId !== undefined) {
        this.finishRemoteControlLocally(remoteSessionId);
      }
      this.notifyListeners();
    });
    socket.on('connect_error', () => {
      this.stopHeartbeat();
      this.stopAuthRefresh();
      this.status = ProfessorPresenceStatus.ERROR;
      this.notifyListeners();
    });
    socket.on('session:requested', (request) => {
      if (this.sessionRequests.some((item) => item.requestId === request.requestId)) {
        return;
      }
      this.sessionRequests = [...this.sessionRequests, request];
      this.sessionNotice = undefined;
      this.scheduleSessionRequestExpiration(request.requestId);
      this.notifyListeners();
    });
    socket.on('session:timeout', (payload) => {
      this.expireSessionRequest(payload.requestId);
    });
    socket.on('session:started', (session) => {
      this.clearSessionRequestExpirationTimers();
      this.sessionRequests = [];
      this.activeSession = session;
      this.sessionNotice = undefined;
      this.remoteControl = createInitialRemoteControlSnapshot();
      this.notifyListeners();
    });
    socket.on('session:ended', (session) => {
      if (this.activeSession?.sessionId === session.sessionId) {
        this.finishRemoteControlLocally(session.sessionId);
        this.activeSession = undefined;
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
    this.notifyListeners();
    return this.getSnapshot();
  }

  public getSnapshot(): ProfessorPresenceSnapshot {
    return {
      professorName: this.professorName,
      status: this.status,
      serverConnected: this.status === ProfessorPresenceStatus.CONNECTED,
      sessionRequests: [...this.sessionRequests],
      activeSession: this.activeSession,
      sessionNotice: this.sessionNotice,
      remoteControl: { ...this.remoteControl, logs: [...this.remoteControl.logs] },
    };
  }

  public acceptSession(requestId: string): ProfessorPresenceSnapshot {
    return this.respondToSession('session:accept', requestId);
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

    return { serverUrl: url.toString() };
  }

  private startHeartbeat(socket: PresenceSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        socket.emit('professor:heartbeat');
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
    this.sessionRequests = [];
    this.activeSession = undefined;
    this.sessionNotice = undefined;
    this.remoteControl = createInitialRemoteControlSnapshot();
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

  private scheduleSessionRequestExpiration(requestId: string): void {
    this.clearSessionRequestExpirationTimer(requestId);
    const timer = setTimeout(() => {
      this.expireSessionRequest(requestId);
    }, this.sessionRequestTimeoutMs);
    timer.unref?.();
    this.sessionRequestExpirationTimers.set(requestId, timer);
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
