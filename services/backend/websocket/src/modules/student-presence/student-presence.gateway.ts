import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { StudentPresenceManager } from './student-presence.manager.js';

export const STUDENT_PRESENCE_EVENTS = {
  DISCONNECT: 'student:disconnect',
  HEARTBEAT: 'student:heartbeat',
  REGISTER: 'student:register',
} as const;

export interface StudentRegisterPayload {
  readonly id: string;
  readonly name: string;
}

interface StudentPresenceClientEvents {
  [STUDENT_PRESENCE_EVENTS.DISCONNECT]: (acknowledge?: () => void) => void;
  [STUDENT_PRESENCE_EVENTS.HEARTBEAT]: (
    acknowledge?: (payload: { readonly serverTime: string }) => void,
  ) => void;
  [STUDENT_PRESENCE_EVENTS.REGISTER]: (payload: StudentRegisterPayload) => void;
}

type StudentPresenceServer = Server<StudentPresenceClientEvents>;
type StudentPresenceSocket = Socket<StudentPresenceClientEvents>;

export class StudentPresenceGateway {
  private cleanupTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly socketServer: StudentPresenceServer,
    private readonly presenceManager: StudentPresenceManager,
    private readonly logger: CommunicationLogger,
    private readonly heartbeatTimeoutMs = 90_000,
    private readonly cleanupIntervalMs = 30_000,
    private readonly onHeartbeat?: (socketId: string) => void,
  ) {}

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
    this.cleanupTimer = setInterval(() => this.removeExpiredStudents(), this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  public dispose(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private registerSocketEvents(socket: StudentPresenceSocket): void {
    socket.on(STUDENT_PRESENCE_EVENTS.REGISTER, (_payload) => {
      const identity = readIdentity(socket);
      const registration =
        identity === undefined ? normalizeStudentRegistration(_payload) : undefined;

      if (
        identity === undefined
          ? registration === undefined
          : !identity.roles.includes('STUDENT') || identity.profileId === undefined
      ) {
        this.logger.error('Perfil do aluno inválido', new Error('Perfil autenticado obrigatório'));
        return;
      }

      this.removeConnectedStudent(socket.id);
      const id = identity?.profileId ?? registration?.id;
      const name = identity?.displayName ?? registration?.name;
      if (id === undefined || name === undefined) return;
      this.presenceManager.registerStudent({
        id,
        name,
        ...(identity === undefined ? {} : { organizationId: identity.organizationId }),
        socketId: socket.id,
      });
      this.logger.info(`Aluno ${name} conectado`);
    });

    socket.on(STUDENT_PRESENCE_EVENTS.HEARTBEAT, (acknowledge) => {
      const student = this.presenceManager.updateHeartbeat(socket.id);

      if (student !== undefined) {
        this.logger.info(`Aluno ${student.name} heartbeat recebido`);
      }
      acknowledge?.({ serverTime: new Date().toISOString() });
      this.onHeartbeat?.(socket.id);
    });

    socket.on(STUDENT_PRESENCE_EVENTS.DISCONNECT, (acknowledge) => {
      this.removeConnectedStudent(socket.id);
      acknowledge?.();
    });
    socket.on('disconnect', () => this.removeConnectedStudent(socket.id));
  }

  private removeConnectedStudent(socketId: string): void {
    const student = this.presenceManager.removeStudent(socketId);

    if (student !== undefined) {
      this.logger.info(`Aluno ${student.name} desconectado`);
    }
  }

  private removeExpiredStudents(): void {
    const expiredStudents = this.presenceManager.removeStudentsWithoutHeartbeat(
      this.heartbeatTimeoutMs,
    );

    for (const student of expiredStudents) {
      this.logger.info(`Aluno ${student.name} removido por timeout`);
    }
  }
}

function readIdentity(socket: StudentPresenceSocket): SocketIdentity | undefined {
  return (socket.data as { identity?: SocketIdentity }).identity;
}

function normalizeStudentRegistration(
  payload: StudentRegisterPayload,
): StudentRegisterPayload | undefined {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.id !== 'string' ||
    typeof payload.name !== 'string'
  )
    return undefined;
  const id = payload.id.trim();
  const name = payload.name.trim();
  return id.length === 0 || name.length === 0 ? undefined : { id, name };
}
