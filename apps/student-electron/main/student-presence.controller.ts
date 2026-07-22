import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { io, type Socket } from 'socket.io-client';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface StudentIdentity {
  readonly id: string;
  readonly name: string;
}

interface StudentPresenceClientEvents {
  'student:disconnect': (acknowledge: () => void) => void;
  'student:heartbeat': () => void;
  'student:register': (payload: StudentIdentity) => void;
}

interface StudentConnectConfig {
  readonly serverUrl: string;
}

type StudentPresenceSocket = Socket<Record<never, never>, StudentPresenceClientEvents>;

export class StudentPresenceController {
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private socket: StudentPresenceSocket | undefined;

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
    socket.connect();
  }

  public dispose(): void {
    this.disconnectSocket();
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
