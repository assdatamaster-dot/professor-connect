import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { PresenceManager } from './presence.manager.js';

export const PROFESSOR_PRESENCE_EVENTS = {
  HEARTBEAT: 'professor:heartbeat',
  ONLINE: 'professor:online',
  AVAILABILITY_GET: 'professor:availability:get',
  AVAILABILITY_SET: 'professor:availability:set',
  AVAILABILITY_CHANGED: 'professor:availability:changed',
  AVAILABLE_LIST: 'professors:available:list',
} as const;

export interface ProfessorOnlinePayload {
  readonly name: string;
}

interface ProfessorPresenceClientEvents {
  [PROFESSOR_PRESENCE_EVENTS.HEARTBEAT]: (
    acknowledge?: (payload: { readonly serverTime: string }) => void,
  ) => void;
  [PROFESSOR_PRESENCE_EVENTS.ONLINE]: (payload: ProfessorOnlinePayload) => void;
  [PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_GET]: () => void;
  [PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_SET]: (
    payload: { readonly available: boolean },
    acknowledge?: (result: { readonly ok: boolean; readonly message?: string }) => void,
  ) => void;
}

export interface AvailableProfessorPayload {
  readonly id: string;
  readonly name: string;
  readonly status: 'available';
  readonly availableSince: string;
  readonly avatarUrl?: string;
}

interface ProfessorPresenceServerEvents {
  [PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_CHANGED]: (payload: {
    readonly available: boolean;
    readonly availableSince?: string;
  }) => void;
  [PROFESSOR_PRESENCE_EVENTS.AVAILABLE_LIST]: (
    payload: readonly AvailableProfessorPayload[],
  ) => void;
}

type ProfessorPresenceServer = Server<ProfessorPresenceClientEvents, ProfessorPresenceServerEvents>;
type ProfessorPresenceSocket = Socket<ProfessorPresenceClientEvents, ProfessorPresenceServerEvents>;

export class ProfessorPresenceGateway {
  private cleanupTimer: NodeJS.Timeout | undefined;
  private readonly stopListeningForChanges: () => void;

  public constructor(
    private readonly socketServer: ProfessorPresenceServer,
    private readonly presenceManager: PresenceManager,
    private readonly logger: CommunicationLogger,
    private readonly heartbeatTimeoutMs = 90_000,
    private readonly cleanupIntervalMs = 30_000,
    private readonly onHeartbeat?: (socketId: string) => void,
  ) {
    this.stopListeningForChanges = presenceManager.onChanged(() => {
      this.broadcastAvailableProfessors();
    });
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
    this.cleanupTimer = setInterval(() => this.removeExpiredProfessors(), this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  public dispose(): void {
    this.stopListeningForChanges();
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private registerSocketEvents(socket: ProfessorPresenceSocket): void {
    socket.on(PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_GET, () => {
      this.sendAvailableProfessors(socket);
    });
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
        ...(identity?.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl }),
        ...(identity === undefined ? {} : { organizationId: identity.organizationId }),
        socketId: socket.id,
      });
      this.logger.info(`Professor ${name} conectado`);
    });

    socket.on(PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_SET, (payload, acknowledge) => {
      try {
        requireTeacherIdentity(socket);
        if (typeof payload?.available !== 'boolean') {
          throw new Error('Disponibilidade inválida');
        }
        const professor = this.presenceManager.setAvailability(
          socket.id,
          payload.available ? 'available' : 'unavailable',
        );
        acknowledge?.({ ok: true });
        this.logger.info('Disponibilidade do professor alterada', {
          professorId: professor.id,
          availability: professor.availability,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao alterar disponibilidade';
        acknowledge?.({ ok: false, message });
        this.logger.error(message, error);
      }
    });

    socket.on(PROFESSOR_PRESENCE_EVENTS.HEARTBEAT, (acknowledge) => {
      const professor = this.presenceManager.updateHeartbeat(socket.id);

      if (professor !== undefined) {
        this.logger.info(`Professor ${professor.name} heartbeat`);
      }
      acknowledge?.({ serverTime: new Date().toISOString() });
      this.onHeartbeat?.(socket.id);
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

  private broadcastAvailableProfessors(): void {
    for (const socket of this.socketServer.sockets.sockets.values()) {
      this.sendAvailableProfessors(socket);
      const professor = this.presenceManager.findProfessorBySocketId(socket.id);
      if (professor !== undefined) {
        socket.emit(PROFESSOR_PRESENCE_EVENTS.AVAILABILITY_CHANGED, {
          available: professor.availability === 'available',
          ...(professor.availableSince === undefined
            ? {}
            : { availableSince: professor.availableSince.toISOString() }),
        });
      }
    }
  }

  private sendAvailableProfessors(socket: ProfessorPresenceSocket): void {
    const identity = readIdentity(socket);
    if (identity === undefined) return;
    const professors = this.presenceManager
      .getAvailableProfessors(identity.organizationId)
      .map((professor) => ({
        id: professor.id,
        name: professor.name,
        status: 'available' as const,
        availableSince: (professor.availableSince ?? professor.onlineSince).toISOString(),
        ...(professor.avatarUrl === undefined ? {} : { avatarUrl: professor.avatarUrl }),
      }));
    socket.emit(PROFESSOR_PRESENCE_EVENTS.AVAILABLE_LIST, professors);
  }
}

function requireTeacherIdentity(socket: ProfessorPresenceSocket): SocketIdentity {
  const identity = readIdentity(socket);
  if (
    identity === undefined ||
    !identity.roles.includes('TEACHER') ||
    !identity.permissions.includes('session.respond')
  ) {
    throw new Error('Operação não autorizada');
  }
  return identity;
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
