import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { PresenceManager } from './presence.manager.js';

export const PROFESSOR_PRESENCE_EVENTS = {
  HEARTBEAT: 'professor:heartbeat',
  ONLINE: 'professor:online',
} as const;

export interface ProfessorOnlinePayload {
  readonly name: string;
}

interface ProfessorPresenceClientEvents {
  [PROFESSOR_PRESENCE_EVENTS.HEARTBEAT]: () => void;
  [PROFESSOR_PRESENCE_EVENTS.ONLINE]: (payload: ProfessorOnlinePayload) => void;
}

type ProfessorPresenceServer = Server<ProfessorPresenceClientEvents>;
type ProfessorPresenceSocket = Socket<ProfessorPresenceClientEvents>;

export class ProfessorPresenceGateway {
  private cleanupTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly socketServer: ProfessorPresenceServer,
    private readonly presenceManager: PresenceManager,
    private readonly logger: CommunicationLogger,
    private readonly heartbeatTimeoutMs = 90_000,
    private readonly cleanupIntervalMs = 30_000,
  ) {}

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
    this.cleanupTimer = setInterval(() => this.removeExpiredProfessors(), this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  public dispose(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private registerSocketEvents(socket: ProfessorPresenceSocket): void {
    socket.on(PROFESSOR_PRESENCE_EVENTS.ONLINE, (_payload) => {
      const identity = readIdentity(socket);
      const name = identity?.displayName ?? normalizeProfessorName(_payload);

      if (
        name === undefined ||
        (identity !== undefined &&
          (!identity.roles.includes('TEACHER') || identity.profileId === undefined))
      ) {
        this.logger.error(
          'Perfil do professor inválido',
          new Error('Perfil autenticado obrigatório'),
        );
        return;
      }

      const previousProfessor = this.presenceManager.removeProfessor(socket.id);
      if (previousProfessor !== undefined) {
        this.logger.info(`Professor ${previousProfessor.name} desconectado`);
      }

      this.presenceManager.registerProfessor({
        ...(identity?.profileId === undefined ? {} : { id: identity.profileId }),
        name,
        ...(identity === undefined ? {} : { organizationId: identity.organizationId }),
        socketId: socket.id,
      });
      this.logger.info(`Professor ${name} conectado`);
    });

    socket.on(PROFESSOR_PRESENCE_EVENTS.HEARTBEAT, () => {
      const professor = this.presenceManager.updateHeartbeat(socket.id);

      if (professor !== undefined) {
        this.logger.info(`Professor ${professor.name} heartbeat`);
      }
    });

    socket.on('disconnect', () => {
      const professor = this.presenceManager.removeProfessor(socket.id);

      if (professor !== undefined) {
        this.logger.info(`Professor ${professor.name} desconectado`);
      }
    });
  }

  private removeExpiredProfessors(): void {
    const expiredProfessors = this.presenceManager.removeProfessorsWithoutHeartbeat(
      this.heartbeatTimeoutMs,
    );

    for (const professor of expiredProfessors) {
      this.logger.info(`Professor ${professor.name} desconectado`);
    }
  }
}

function readIdentity(socket: ProfessorPresenceSocket): SocketIdentity | undefined {
  return (socket.data as { identity?: SocketIdentity }).identity;
}

function normalizeProfessorName(payload: ProfessorOnlinePayload): string | undefined {
  if (typeof payload !== 'object' || payload === null || typeof payload.name !== 'string')
    return undefined;
  const name = payload.name.trim();
  return name.length === 0 ? undefined : name;
}
