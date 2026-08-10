import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SocketIdentity } from '../../auth/socket-auth.types.js';
import type { SessionManager } from '../active-session/session.manager.js';
import type { SessionRequestManager } from '../session-request/session-request.manager.js';
import type { StudentPresenceManager } from './student-presence.manager.js';

export const STUDENT_PRESENCE_EVENTS = {
  DISCONNECT: 'student:disconnect',
  HEARTBEAT: 'student:heartbeat',
  REGISTER: 'student:register',
  OPERATIONAL_GET: 'students:presence:get',
  OPERATIONAL_CHANGED: 'students:presence:changed',
} as const;

export interface OperationalStudentPresencePayload {
  readonly id: string;
  readonly name: string;
  readonly connectionStatus: 'online' | 'reconnecting';
  readonly attendanceStatus: 'available' | 'waiting' | 'in_attendance';
  readonly onlineSince: string;
  readonly lastHeartbeat: string;
  readonly requestId?: string;
  readonly position?: number;
  readonly queuedAt?: string;
  readonly sessionId?: string;
  readonly attendanceStartedAt?: string;
}

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
  [STUDENT_PRESENCE_EVENTS.OPERATIONAL_GET]: () => void;
}

interface StudentPresenceServerEvents {
  [STUDENT_PRESENCE_EVENTS.OPERATIONAL_CHANGED]: (
    payload: readonly OperationalStudentPresencePayload[],
  ) => void;
}

type StudentPresenceServer = Server<StudentPresenceClientEvents, StudentPresenceServerEvents>;
type StudentPresenceSocket = Socket<StudentPresenceClientEvents, StudentPresenceServerEvents>;

export class StudentPresenceGateway {
  private cleanupTimer: NodeJS.Timeout | undefined;
  private readonly stopListening: Array<() => void> = [];

  public constructor(
    private readonly socketServer: StudentPresenceServer,
    private readonly presenceManager: StudentPresenceManager,
    private readonly logger: CommunicationLogger,
    private readonly heartbeatTimeoutMs = 90_000,
    private readonly cleanupIntervalMs = 30_000,
    private readonly onHeartbeat?: (socketId: string) => void,
    private readonly requestManager?: SessionRequestManager,
    private readonly sessionManager?: SessionManager,
  ) {
    this.stopListening.push(presenceManager.onChanged(() => this.broadcastOperationalPresence()));
    if (requestManager !== undefined) {
      this.stopListening.push(
        requestManager.onQueueChanged(() => this.broadcastOperationalPresence()),
      );
    }
    if (sessionManager !== undefined) {
      this.stopListening.push(
        sessionManager.onSessionStarted(() => this.broadcastOperationalPresence()),
        sessionManager.onSessionEnded(() => this.broadcastOperationalPresence()),
      );
    }
  }

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
    this.cleanupTimer = setInterval(() => this.removeExpiredStudents(), this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  public dispose(): void {
    for (const stop of this.stopListening.splice(0)) stop();
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private registerSocketEvents(socket: StudentPresenceSocket): void {
    socket.on(STUDENT_PRESENCE_EVENTS.OPERATIONAL_GET, () => {
      try {
        requireTeacherIdentity(socket);
        this.sendOperationalPresence(socket);
      } catch (error) {
        this.logger.error('Consulta de presen\u00e7a dos alunos n\u00e3o autorizada', error);
      }
    });
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
    socket.on('disconnect', (reason) => {
      if (reason === 'client namespace disconnect' || reason === 'server namespace disconnect') {
        this.removeConnectedStudent(socket.id);
        return;
      }
      const student = this.presenceManager.markReconnecting(socket.id);
      if (student !== undefined) {
        this.logger.info(`Aluno ${student.name} aguardando reconex\u00e3o`);
      }
    });
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

  private broadcastOperationalPresence(): void {
    for (const socket of this.socketServer.sockets.sockets.values()) {
      const identity = readIdentity(socket);
      if (identity?.roles.includes('TEACHER') === true) this.sendOperationalPresence(socket);
    }
  }

  private sendOperationalPresence(socket: StudentPresenceSocket): void {
    const identity = requireTeacherIdentity(socket);
    const students = this.presenceManager
      .getTrackedStudents()
      .filter((student) => student.organizationId === identity.organizationId)
      .map((student): OperationalStudentPresencePayload => {
        const session = this.sessionManager
          ?.listActiveSessions()
          .find((item) => item.studentId === student.id);
        if (session !== undefined) {
          return {
            id: student.id,
            name: student.name,
            connectionStatus: student.connectionStatus,
            attendanceStatus: 'in_attendance',
            onlineSince: student.onlineSince.toISOString(),
            lastHeartbeat: student.lastHeartbeat.toISOString(),
            ...(session.teacherId === identity.profileId
              ? { sessionId: session.sessionId, attendanceStartedAt: session.createdAt }
              : {}),
          };
        }
        const queue = this.requestManager?.getQueueForStudent(student.id);
        if (queue !== undefined) {
          return {
            id: student.id,
            name: student.name,
            connectionStatus: student.connectionStatus,
            attendanceStatus: 'waiting',
            onlineSince: student.onlineSince.toISOString(),
            lastHeartbeat: student.lastHeartbeat.toISOString(),
            ...(queue.teacherId === identity.profileId
              ? {
                  requestId: queue.requestId,
                  position: queue.position,
                  queuedAt: queue.queuedAt ?? queue.createdAt,
                }
              : {}),
          };
        }
        return {
          id: student.id,
          name: student.name,
          connectionStatus: student.connectionStatus,
          attendanceStatus: 'available',
          onlineSince: student.onlineSince.toISOString(),
          lastHeartbeat: student.lastHeartbeat.toISOString(),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    socket.emit(STUDENT_PRESENCE_EVENTS.OPERATIONAL_CHANGED, students);
  }
}

function requireTeacherIdentity(socket: StudentPresenceSocket): SocketIdentity {
  const identity = readIdentity(socket);
  if (
    identity === undefined ||
    identity.profileId === undefined ||
    !identity.roles.includes('TEACHER') ||
    !identity.permissions.includes('students.online.read')
  ) {
    throw new Error('Opera\u00e7\u00e3o n\u00e3o autorizada');
  }
  return identity;
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
