import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { io, type Socket } from 'socket.io-client';

import type {
  OnlineTeacher,
  StudentSessionListener,
  StudentSessionSnapshot,
} from '../shared/session-contracts.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface StudentIdentity {
  readonly id: string;
  readonly name: string;
}

interface StudentPresenceClientEvents {
  'student:disconnect': (acknowledge: () => void) => void;
  'student:heartbeat': () => void;
  'student:register': (payload: StudentIdentity) => void;
  'request:session': (payload: { readonly teacherId: string }) => void;
}

interface StudentPresenceServerEvents {
  'session:accepted': (payload: SessionResponsePayload) => void;
  'session:rejected': (payload: SessionResponsePayload) => void;
  'session:timeout': (payload: SessionResponsePayload) => void;
}

interface SessionResponsePayload {
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
}

interface StudentConnectConfig {
  readonly serverUrl: string;
}

type StudentPresenceSocket = Socket<StudentPresenceServerEvents, StudentPresenceClientEvents>;

export class StudentPresenceController {
  private readonly sessionListeners = new Set<StudentSessionListener>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private socket: StudentPresenceSocket | undefined;
  private sessionState: StudentSessionSnapshot = {
    status: 'idle',
    message: 'Pronto para solicitar atendimento.',
  };

  public constructor(
    private readonly configPath: string,
    private readonly identity: StudentIdentity = { id: randomUUID(), name: 'Aluno' },
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  ) {}

  public async connect(): Promise<void> {
    this.disconnectSocket();

    const { serverUrl } = await this.loadConfig();
    const socket: StudentPresenceSocket = io(serverUrl, { autoConnect: false });

    this.socket = socket;
    socket.on('connect', () => {
      socket.emit('student:register', this.identity);
      this.startHeartbeat(socket);
    });
    socket.on('disconnect', () => this.stopHeartbeat());
    socket.on('connect_error', () => this.stopHeartbeat());
    socket.on('session:accepted', () => {
      this.updateSessionState('accepted', 'Professor aceitou');
    });
    socket.on('session:rejected', () => {
      this.updateSessionState('rejected', 'Professor recusou');
    });
    socket.on('session:timeout', () => {
      this.updateSessionState('timeout', 'Tempo esgotado');
    });
    socket.connect();
  }

  public async getOnlineTeachers(): Promise<readonly OnlineTeacher[]> {
    const { serverUrl } = await this.loadConfig();
    const response = await fetch(new URL('/api/professors/online', serverUrl));
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
    return professors.filter(isOnlineTeacher);
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
    this.updateSessionState('waiting', 'Aguardando resposta...');
    return this.getSessionSnapshot();
  }

  public getSessionSnapshot(): StudentSessionSnapshot {
    return { ...this.sessionState };
  }

  public onSessionStateChanged(listener: StudentSessionListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  public dispose(): void {
    this.disconnectSocket();
    this.sessionListeners.clear();
  }

  private updateSessionState(status: StudentSessionSnapshot['status'], message: string): void {
    this.sessionState = { status, message };
    const snapshot = this.getSessionSnapshot();
    for (const listener of this.sessionListeners) {
      listener(snapshot);
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
    typeof value.name === 'string'
  );
}
