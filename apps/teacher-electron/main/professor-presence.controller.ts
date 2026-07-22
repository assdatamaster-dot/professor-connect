import { readFile } from 'node:fs/promises';

import { io, type Socket } from 'socket.io-client';

import {
  ProfessorPresenceStatus,
  type ProfessorPresenceSnapshot,
} from '../shared/presence-contracts.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface ProfessorPresenceClientEvents {
  'professor:heartbeat': () => void;
  'professor:online': (payload: { readonly name: string }) => void;
}

interface ProfessorConnectConfig {
  readonly serverUrl: string;
}

type PresenceListener = (snapshot: ProfessorPresenceSnapshot) => void;
type PresenceSocket = Socket<Record<never, never>, ProfessorPresenceClientEvents>;

export class ProfessorPresenceController {
  private connectionGeneration = 0;
  private readonly listeners = new Set<PresenceListener>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private professorName: string | undefined;
  private socket: PresenceSocket | undefined;
  private status = ProfessorPresenceStatus.DISCONNECTED;

  public constructor(private readonly configPath: string) {}

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
    const socket: PresenceSocket = io(serverUrl, { autoConnect: false });

    this.socket = socket;
    socket.on('connect', () => {
      this.status = ProfessorPresenceStatus.CONNECTED;
      socket.emit('professor:online', { name });
      this.startHeartbeat(socket);
      this.notifyListeners();
    });
    socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.status = ProfessorPresenceStatus.DISCONNECTED;
      this.notifyListeners();
    });
    socket.on('connect_error', () => {
      this.stopHeartbeat();
      this.status = ProfessorPresenceStatus.ERROR;
      this.notifyListeners();
    });
    socket.connect();

    return this.getSnapshot();
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
    };
  }

  public onStateChanged(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.connectionGeneration += 1;
    this.disconnectSocket();
    this.listeners.clear();
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
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = undefined;
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
