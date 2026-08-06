import {
  AttendanceSessionStatus,
  AuditSeverity,
  FileTransferDirection,
  FileTransferStatus,
  PresenceRole,
  ProfessorAvailability,
  type Prisma,
  type PrismaClient,
  RequestStatus,
  SupportCallStatus,
  WorkflowSessionStatus,
} from '@prisma/client';

import type { PersistenceQueue } from '../persistence-queue.js';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

type SessionRequestWithParticipants = Prisma.SessionRequestGetPayload<{
  include: { professor: true; student: true };
}>;
type AttendanceSessionWithParticipants = Prisma.AttendanceSessionGetPayload<{
  include: { professor: true; student: true };
}>;

export interface ProfessorRecord {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
  readonly availability: 'available' | 'unavailable' | 'busy';
  readonly availableSince: Date | undefined;
}

export interface StudentRecord {
  readonly id: string;
  readonly name: string;
  readonly socketId: string;
  readonly onlineSince: Date;
  readonly lastHeartbeat: Date;
}

export interface SessionRequestRecord {
  readonly requestId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  readonly createdAt: string;
  readonly respondedAt?: string;
}

export interface AttendanceSessionRecord {
  readonly sessionId: string;
  readonly requestId: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly createdAt: string;
  readonly status: 'active' | 'finished';
  readonly connectionState?:
    | 'WAITING'
    | 'CONNECTING'
    | 'CONNECTED'
    | 'RECONNECTING'
    | 'RECOVERING'
    | 'DISCONNECTED'
    | 'FINISHED';
  readonly stateUpdatedAt?: string;
  readonly recoveryDeadline?: string;
  readonly teacherRecoveryTokenHash?: string;
  readonly studentRecoveryTokenHash?: string;
  readonly lastHeartbeatAt?: string;
  readonly connectedMilliseconds?: number;
  readonly reconnectingMilliseconds?: number;
  readonly disconnectCount?: number;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly endReason?: string;
}

export interface AuditRecord {
  readonly action: string;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly severity?: 'info' | 'warning' | 'error';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FileTransferRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly direction: 'teacher-to-student' | 'student-to-teacher';
  readonly fileName: string;
  readonly mimeType?: string;
  readonly byteSize: bigint;
  readonly checksum?: string;
  readonly status:
    'requested' | 'accepted' | 'in-progress' | 'completed' | 'rejected' | 'cancelled' | 'failed';
  readonly failureReason?: string;
  readonly averageBytesPerSecond?: bigint;
  readonly durationMilliseconds?: bigint;
  readonly startedAt: Date;
  readonly completedAt?: Date;
}

export interface WorkflowPresenceRecord {
  readonly clientId: string;
  readonly connectionId: string;
  readonly displayName: string;
  readonly role: 'TEACHER' | 'STUDENT';
  readonly status: 'ONLINE' | 'AVAILABLE' | 'BUSY' | 'OFFLINE';
  readonly lastSeen: string;
}

export interface WorkflowRequestRecord {
  readonly requestId: string;
  readonly studentId: string;
  readonly teacherId?: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  readonly createdAt: string;
  readonly acceptedAt?: string;
  readonly expiresAt: string;
}

export interface WorkflowCallRecord {
  readonly callId: string;
  readonly requestId: string;
  readonly sessionId?: string;
  readonly studentId: string;
  readonly teacherId: string;
  readonly status: 'CREATED' | 'CONNECTING' | 'CONNECTED' | 'FINISHED' | 'FAILED' | 'CANCELLED';
  readonly createdAt: string;
  readonly connectedAt?: string;
  readonly finishedAt?: string;
}

export interface WorkflowSessionRecord {
  readonly id: string;
  readonly clientIds: readonly string[];
  readonly status: 'WAITING' | 'ACTIVE' | 'FINISHED';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ProfessorRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveProfessor(professor: ProfessorRecord): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.professor.upsert({
          where: { id: professor.id },
          create: {
            id: professor.id,
            name: professor.name,
            availability: toProfessorAvailability(professor.availability),
            availableSince: professor.availableSince ?? null,
          },
          update: {
            name: professor.name,
            availability: toProfessorAvailability(professor.availability),
            availableSince: professor.availableSince ?? null,
          },
        }),
        this.prisma.presenceConnection.create({
          data: {
            professorId: professor.id,
            role: PresenceRole.TEACHER,
            socketId: professor.socketId,
            connectedAt: professor.onlineSince,
            lastHeartbeat: professor.lastHeartbeat,
          },
        }),
      ]),
    );
  }

  public updateAvailability(
    professorId: string,
    availability: ProfessorRecord['availability'],
    availableSince: Date | undefined,
  ): void {
    this.queue.enqueue(() =>
      this.prisma.professor.updateMany({
        where: { id: professorId },
        data: {
          availability: toProfessorAvailability(availability),
          availableSince: availableSince ?? null,
        },
      }),
    );
  }

  public updateHeartbeat(socketId: string, at: Date): void {
    this.queue.enqueue(() =>
      this.prisma.presenceConnection.updateMany({
        where: { socketId, isOnline: true },
        data: { lastHeartbeat: at },
      }),
    );
  }

  public markOffline(socketId: string, at: Date): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.presenceConnection.updateMany({
          where: { socketId, isOnline: true },
          data: { isOnline: false, disconnectedAt: at },
        }),
        this.prisma.professor.updateMany({
          where: { presences: { some: { socketId } } },
          data: { availability: ProfessorAvailability.UNAVAILABLE, availableSince: null },
        }),
      ]),
    );
  }
}

export class StudentRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveStudent(student: StudentRecord): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.student.upsert({
          where: { id: student.id },
          create: { id: student.id, name: student.name },
          update: { name: student.name },
        }),
        this.prisma.presenceConnection.create({
          data: {
            studentId: student.id,
            role: PresenceRole.STUDENT,
            socketId: student.socketId,
            connectedAt: student.onlineSince,
            lastHeartbeat: student.lastHeartbeat,
          },
        }),
      ]),
    );
  }

  public updateHeartbeat(socketId: string, at: Date): void {
    this.queue.enqueue(() =>
      this.prisma.presenceConnection.updateMany({
        where: { socketId, isOnline: true },
        data: { lastHeartbeat: at },
      }),
    );
  }

  public markOffline(socketId: string, at: Date): void {
    this.queue.enqueue(() =>
      this.prisma.presenceConnection.updateMany({
        where: { socketId, isOnline: true },
        data: { isOnline: false, disconnectedAt: at },
      }),
    );
  }
}

export class SessionRequestRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveRequest(request: SessionRequestRecord): void {
    const status = toRequestStatus(request.status);
    const occurredAt =
      request.respondedAt === undefined ? new Date() : new Date(request.respondedAt);
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.sessionRequest.upsert({
          where: { id: request.requestId },
          create: {
            id: request.requestId,
            professorId: request.teacherId,
            studentId: request.studentId,
            status,
            createdAt: new Date(request.createdAt),
          },
          update: {
            status,
            ...(status === RequestStatus.PENDING ? {} : { respondedAt: occurredAt }),
          },
        }),
        this.prisma.domainEvent.create({
          data: {
            requestId: request.requestId,
            type: `session-request.${request.status}`,
            payload: toJson({ teacherId: request.teacherId, studentId: request.studentId }),
            occurredAt,
          },
        }),
      ]),
    );
  }

  public async listHistory(): Promise<readonly SessionRequestRecord[]> {
    const requests = await this.prisma.sessionRequest.findMany({
      include: { professor: true, student: true },
      orderBy: { createdAt: 'asc' },
    });
    return requests.flatMap((request: SessionRequestWithParticipants): SessionRequestRecord[] => {
      if (request.professorId === null || request.professor === null) {
        return [];
      }
      return [
        {
          requestId: request.id,
          studentId: request.studentId,
          studentName: request.student.name,
          teacherId: request.professorId,
          teacherName: request.professor.name,
          status: fromRequestStatus(request.status),
          createdAt: request.createdAt.toISOString(),
          ...(request.respondedAt === null
            ? {}
            : { respondedAt: request.respondedAt.toISOString() }),
        },
      ];
    });
  }
}

export class AttendanceSessionRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveSession(session: AttendanceSessionRecord, endReason?: string): void {
    const occurredAt = new Date();
    const startedAt = new Date(session.createdAt);
    const finished = session.status === 'finished';
    const endedAt = session.endedAt === undefined ? occurredAt : new Date(session.endedAt);
    const persistedDuration = session.durationSeconds ?? durationSeconds(startedAt, endedAt);
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.attendanceSession.upsert({
          where: { id: session.sessionId },
          create: {
            id: session.sessionId,
            requestId: session.requestId,
            professorId: session.teacherId,
            studentId: session.studentId,
            status: finished ? AttendanceSessionStatus.FINISHED : AttendanceSessionStatus.CONNECTED,
            startedAt,
            stateUpdatedAt: new Date(session.stateUpdatedAt ?? session.createdAt),
            teacherRecoveryTokenHash: session.teacherRecoveryTokenHash ?? null,
            studentRecoveryTokenHash: session.studentRecoveryTokenHash ?? null,
            lastHeartbeatAt:
              session.lastHeartbeatAt === undefined ? null : new Date(session.lastHeartbeatAt),
            connectedMilliseconds: BigInt(session.connectedMilliseconds ?? 0),
            reconnectingMilliseconds: BigInt(session.reconnectingMilliseconds ?? 0),
            disconnectCount: session.disconnectCount ?? 0,
            ...(finished
              ? {
                  endedAt,
                  durationSeconds: persistedDuration,
                  endReason: session.endReason ?? endReason ?? 'participant',
                  recoveryDeadline: null,
                  teacherRecoveryTokenHash: null,
                  studentRecoveryTokenHash: null,
                }
              : {}),
          },
          update: finished
            ? {
                status: AttendanceSessionStatus.FINISHED,
                endedAt,
                durationSeconds: persistedDuration,
                endReason: session.endReason ?? endReason ?? 'participant',
                recoveryDeadline: null,
                teacherRecoveryTokenHash: null,
                studentRecoveryTokenHash: null,
              }
            : { status: AttendanceSessionStatus.CONNECTED },
        }),
        this.prisma.domainEvent.create({
          data: {
            sessionId: session.sessionId,
            type: finished ? 'session.finished' : 'session.started',
            payload: toJson({
              endReason,
              teacherId: session.teacherId,
              studentId: session.studentId,
            }),
            occurredAt,
          },
        }),
      ]),
    );
  }

  public saveRecoveryState(session: AttendanceSessionRecord): void {
    const status = toAttendanceSessionStatus(session.connectionState);
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.attendanceSession.update({
          where: { id: session.sessionId },
          data: {
            status,
            stateUpdatedAt: new Date(session.stateUpdatedAt ?? session.createdAt),
            recoveryDeadline:
              session.recoveryDeadline === undefined ? null : new Date(session.recoveryDeadline),
            teacherRecoveryTokenHash: session.teacherRecoveryTokenHash ?? null,
            studentRecoveryTokenHash: session.studentRecoveryTokenHash ?? null,
            lastHeartbeatAt:
              session.lastHeartbeatAt === undefined ? null : new Date(session.lastHeartbeatAt),
            connectedMilliseconds: BigInt(session.connectedMilliseconds ?? 0),
            reconnectingMilliseconds: BigInt(session.reconnectingMilliseconds ?? 0),
            disconnectCount: session.disconnectCount ?? 0,
          },
        }),
        this.prisma.domainEvent.create({
          data: {
            sessionId: session.sessionId,
            type: `session.state.${status.toLowerCase()}`,
            payload: toJson({
              recoveryDeadline: session.recoveryDeadline,
              disconnectCount: session.disconnectCount,
            }),
          },
        }),
      ]),
    );
  }

  public saveConnectionHealth(session: AttendanceSessionRecord): void {
    this.queue.enqueue(() =>
      this.prisma.attendanceSession.update({
        where: { id: session.sessionId },
        data: {
          lastHeartbeatAt:
            session.lastHeartbeatAt === undefined ? null : new Date(session.lastHeartbeatAt),
          connectedMilliseconds: BigInt(session.connectedMilliseconds ?? 0),
          reconnectingMilliseconds: BigInt(session.reconnectingMilliseconds ?? 0),
          disconnectCount: session.disconnectCount ?? 0,
        },
      }),
    );
  }

  public markFeatureUsed(
    sessionId: string,
    feature: 'screen-share' | 'remote-control' | 'file-transfer',
  ): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.attendanceSession.update({
          where: { id: sessionId },
          data: {
            ...(feature === 'screen-share' ? { usedScreenShare: true } : {}),
            ...(feature === 'remote-control' ? { usedRemoteControl: true } : {}),
            ...(feature === 'file-transfer' ? { usedFileTransfer: true } : {}),
          },
        }),
        this.prisma.domainEvent.create({
          data: { sessionId, type: `session.feature.${feature}` },
        }),
      ]),
    );
  }

  public async listHistory(): Promise<readonly AttendanceSessionRecord[]> {
    const sessions = await this.prisma.attendanceSession.findMany({
      include: { professor: true, student: true },
      orderBy: { startedAt: 'asc' },
    });
    return sessions.map((session: AttendanceSessionWithParticipants) => ({
      sessionId: session.id,
      requestId: session.requestId,
      teacherId: session.professorId,
      teacherName: session.professor.name,
      studentId: session.studentId,
      studentName: session.student.name,
      createdAt: session.startedAt.toISOString(),
      status:
        session.status === AttendanceSessionStatus.FINISHED ||
        session.status === AttendanceSessionStatus.INTERRUPTED
          ? 'finished'
          : 'active',
      connectionState: fromAttendanceSessionStatus(session.status),
      stateUpdatedAt: session.stateUpdatedAt.toISOString(),
      ...(session.recoveryDeadline === null
        ? {}
        : { recoveryDeadline: session.recoveryDeadline.toISOString() }),
      ...(session.teacherRecoveryTokenHash === null
        ? {}
        : { teacherRecoveryTokenHash: session.teacherRecoveryTokenHash }),
      ...(session.studentRecoveryTokenHash === null
        ? {}
        : { studentRecoveryTokenHash: session.studentRecoveryTokenHash }),
      ...(session.lastHeartbeatAt === null
        ? {}
        : { lastHeartbeatAt: session.lastHeartbeatAt.toISOString() }),
      connectedMilliseconds: Number(session.connectedMilliseconds),
      reconnectingMilliseconds: Number(session.reconnectingMilliseconds),
      disconnectCount: session.disconnectCount,
      ...(session.endedAt === null ? {} : { endedAt: session.endedAt.toISOString() }),
      ...(session.durationSeconds === null ? {} : { durationSeconds: session.durationSeconds }),
      ...(session.endReason === null ? {} : { endReason: session.endReason }),
    }));
  }
}

export class FileTransferRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public save(transfer: FileTransferRecord): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction([
        this.prisma.fileTransfer.upsert({
          where: { id: transfer.id },
          create: {
            id: transfer.id,
            sessionId: transfer.sessionId,
            direction: toTransferDirection(transfer.direction),
            fileName: transfer.fileName,
            byteSize: transfer.byteSize,
            status: toTransferStatus(transfer.status),
            startedAt: transfer.startedAt,
            ...(transfer.mimeType === undefined ? {} : { mimeType: transfer.mimeType }),
            ...(transfer.checksum === undefined ? {} : { checksum: transfer.checksum }),
            ...(transfer.failureReason === undefined
              ? {}
              : { failureReason: transfer.failureReason }),
            ...(transfer.completedAt === undefined ? {} : { completedAt: transfer.completedAt }),
            ...(transfer.averageBytesPerSecond === undefined
              ? {}
              : { averageBytesPerSecond: transfer.averageBytesPerSecond }),
            ...(transfer.durationMilliseconds === undefined
              ? {}
              : { durationMilliseconds: transfer.durationMilliseconds }),
          },
          update: {
            status: toTransferStatus(transfer.status),
            ...(transfer.checksum === undefined ? {} : { checksum: transfer.checksum }),
            ...(transfer.failureReason === undefined
              ? {}
              : { failureReason: transfer.failureReason }),
            ...(transfer.completedAt === undefined ? {} : { completedAt: transfer.completedAt }),
            ...(transfer.averageBytesPerSecond === undefined
              ? {}
              : { averageBytesPerSecond: transfer.averageBytesPerSecond }),
            ...(transfer.durationMilliseconds === undefined
              ? {}
              : { durationMilliseconds: transfer.durationMilliseconds }),
          },
        }),
        this.prisma.attendanceSession.update({
          where: { id: transfer.sessionId },
          data: { usedFileTransfer: true },
        }),
      ]),
    );
  }

  public recordAudit(record: {
    readonly action: string;
    readonly actorType: 'teacher' | 'student';
    readonly entityId: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly metadata: Readonly<Record<string, unknown>>;
  }): void {
    this.queue.enqueue(() =>
      this.prisma.auditLog.create({
        data: {
          action: record.action,
          actorType: record.actorType,
          entityType: 'file-transfer',
          entityId: record.entityId,
          severity: toSeverity(record.severity),
          metadata: toJson(record.metadata),
        },
      }),
    );
  }
}

export class AuditRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public record(record: AuditRecord): void {
    this.queue.enqueue(() =>
      this.prisma.auditLog.create({
        data: {
          action: record.action,
          severity: toSeverity(record.severity),
          ...(record.actorType === undefined ? {} : { actorType: record.actorType }),
          ...(record.actorId === undefined ? {} : { actorId: record.actorId }),
          ...(record.entityType === undefined ? {} : { entityType: record.entityType }),
          ...(record.entityId === undefined ? {} : { entityId: record.entityId }),
          ...(record.metadata === undefined ? {} : { metadata: toJson(record.metadata) }),
        },
      }),
    );
  }

  public recordApplicationLog(
    level: 'info' | 'error',
    event: string,
    context?: Readonly<Record<string, unknown>>,
  ): void {
    this.queue.enqueue(() =>
      this.prisma.applicationLog.create({
        data: {
          level: level === 'error' ? AuditSeverity.ERROR : AuditSeverity.INFO,
          origin: 'backend',
          event,
          ...(context === undefined ? {} : { context: toJson(context) }),
        },
      }),
    );
  }
}

export class RecoveryRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async recoverAfterRestart(now = new Date(), recoveryWindowMs = 90_000): Promise<void> {
    await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await transaction.presenceConnection.updateMany({
        where: { isOnline: true },
        data: { isOnline: false, disconnectedAt: now },
      });
      await transaction.professor.updateMany({
        data: { availability: ProfessorAvailability.UNAVAILABLE, availableSince: null },
      });
      await transaction.sessionRequest.updateMany({
        where: { status: RequestStatus.PENDING },
        data: { status: RequestStatus.EXPIRED, respondedAt: now },
      });
      await transaction.workflowSession.updateMany({
        where: { status: { in: [WorkflowSessionStatus.WAITING, WorkflowSessionStatus.ACTIVE] } },
        data: { status: WorkflowSessionStatus.FINISHED, updatedAt: now },
      });
      await transaction.supportCall.updateMany({
        where: {
          status: {
            in: [
              SupportCallStatus.CREATED,
              SupportCallStatus.CONNECTING,
              SupportCallStatus.CONNECTED,
            ],
          },
        },
        data: { status: SupportCallStatus.FAILED, finishedAt: now },
      });
      const recoveryDeadline = new Date(now.getTime() + recoveryWindowMs);
      await transaction.$executeRaw`
        UPDATE "attendance_sessions"
        SET "status" = 'RECOVERING'::"AttendanceSessionStatus",
            "state_updated_at" = ${now},
            "recovery_deadline" = ${recoveryDeadline},
            "disconnect_count" = "disconnect_count" + 1
        WHERE "status" IN (
          'ACTIVE'::"AttendanceSessionStatus",
          'CONNECTED'::"AttendanceSessionStatus",
          'RECONNECTING'::"AttendanceSessionStatus",
          'RECOVERING'::"AttendanceSessionStatus"
        )
      `;
      await transaction.auditLog.create({
        data: {
          action: 'backend.recovered-after-restart',
          entityType: 'backend',
          severity: AuditSeverity.WARNING,
          metadata: toJson({
            recoveredAt: now.toISOString(),
            recoveryDeadline: recoveryDeadline.toISOString(),
          }),
        },
      });
    });
  }
}

export class WorkflowPresenceRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public savePresence(client: WorkflowPresenceRecord): void {
    const lastSeen = new Date(client.lastSeen);
    this.queue.enqueue(() =>
      this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        if (client.role === 'TEACHER') {
          const availability = workflowProfessorAvailability(client.status);
          await transaction.professor.upsert({
            where: { id: client.clientId },
            create: {
              id: client.clientId,
              name: client.displayName,
              availability,
              availableSince: availability === ProfessorAvailability.AVAILABLE ? lastSeen : null,
            },
            update: {
              name: client.displayName,
              availability,
              availableSince: availability === ProfessorAvailability.AVAILABLE ? lastSeen : null,
            },
          });
        } else {
          await transaction.student.upsert({
            where: { id: client.clientId },
            create: { id: client.clientId, name: client.displayName },
            update: { name: client.displayName },
          });
        }

        const activeConnection = await transaction.presenceConnection.findFirst({
          where: { socketId: client.connectionId, isOnline: true },
          select: { id: true },
        });
        if (activeConnection === null && client.status !== 'OFFLINE') {
          await transaction.presenceConnection.create({
            data: {
              role: client.role === 'TEACHER' ? PresenceRole.TEACHER : PresenceRole.STUDENT,
              socketId: client.connectionId,
              connectedAt: lastSeen,
              lastHeartbeat: lastSeen,
              ...(client.role === 'TEACHER'
                ? { professorId: client.clientId }
                : { studentId: client.clientId }),
            },
          });
          return;
        }
        if (activeConnection !== null) {
          await transaction.presenceConnection.update({
            where: { id: activeConnection.id },
            data:
              client.status === 'OFFLINE'
                ? { isOnline: false, disconnectedAt: lastSeen, lastHeartbeat: lastSeen }
                : { lastHeartbeat: lastSeen },
          });
        }
      }),
    );
  }
}

export class WorkflowRequestRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveWorkflowRequest(
    request: WorkflowRequestRecord,
    recipientTeacherIds: readonly string[] = [],
  ): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.sessionRequest.upsert({
          where: { id: request.requestId },
          create: {
            id: request.requestId,
            studentId: request.studentId,
            professorId: request.teacherId ?? null,
            status: RequestStatus[request.status],
            createdAt: new Date(request.createdAt),
            expiresAt: new Date(request.expiresAt),
            ...(request.acceptedAt === undefined
              ? {}
              : { respondedAt: new Date(request.acceptedAt) }),
          },
          update: {
            professorId: request.teacherId ?? null,
            status: RequestStatus[request.status],
            ...(request.acceptedAt === undefined
              ? {}
              : { respondedAt: new Date(request.acceptedAt) }),
          },
        });
        for (const professorId of recipientTeacherIds) {
          await transaction.sessionRequestRecipient.upsert({
            where: { requestId_professorId: { requestId: request.requestId, professorId } },
            create: { requestId: request.requestId, professorId },
            update: {},
          });
        }
        await transaction.domainEvent.create({
          data: {
            requestId: request.requestId,
            type: `workflow-request.${request.status.toLowerCase()}`,
          },
        });
      }),
    );
  }

  public recordWorkflowRejection(requestId: string, teacherId: string): void {
    this.queue.enqueue(() =>
      this.prisma.sessionRequestRecipient.update({
        where: { requestId_professorId: { requestId, professorId: teacherId } },
        data: { rejectedAt: new Date() },
      }),
    );
  }
}

export class WorkflowCallRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveWorkflowCall(call: WorkflowCallRecord): void {
    this.queue.enqueue(() =>
      this.prisma.supportCall.upsert({
        where: { id: call.callId },
        create: {
          id: call.callId,
          requestId: call.requestId,
          sessionId: call.sessionId ?? null,
          studentId: call.studentId,
          professorId: call.teacherId,
          status: SupportCallStatus[call.status],
          createdAt: new Date(call.createdAt),
          ...(call.connectedAt === undefined ? {} : { connectedAt: new Date(call.connectedAt) }),
          ...(call.finishedAt === undefined ? {} : { finishedAt: new Date(call.finishedAt) }),
        },
        update: {
          sessionId: call.sessionId ?? null,
          status: SupportCallStatus[call.status],
          ...(call.connectedAt === undefined ? {} : { connectedAt: new Date(call.connectedAt) }),
          ...(call.finishedAt === undefined ? {} : { finishedAt: new Date(call.finishedAt) }),
        },
      }),
    );
  }
}

export class WorkflowSessionRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: PersistenceQueue,
  ) {}

  public saveWorkflowSession(session: WorkflowSessionRecord): void {
    this.queue.enqueue(() =>
      this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.workflowSession.upsert({
          where: { id: session.id },
          create: {
            id: session.id,
            status: WorkflowSessionStatus[session.status],
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
          },
          update: {
            status: WorkflowSessionStatus[session.status],
            updatedAt: new Date(session.updatedAt),
          },
        });
        await transaction.workflowSessionParticipant.deleteMany({
          where: { sessionId: session.id, clientId: { notIn: [...session.clientIds] } },
        });
        for (const clientId of session.clientIds) {
          await transaction.workflowSessionParticipant.upsert({
            where: { sessionId_clientId: { sessionId: session.id, clientId } },
            create: { sessionId: session.id, clientId },
            update: {},
          });
        }
      }),
    );
  }

  public removeWorkflowSession(sessionId: string): void {
    this.queue.enqueue(() =>
      this.prisma.workflowSession.update({
        where: { id: sessionId },
        data: { status: WorkflowSessionStatus.FINISHED, updatedAt: new Date() },
      }),
    );
  }
}

function durationSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000));
}

function toAttendanceSessionStatus(
  state: AttendanceSessionRecord['connectionState'],
): AttendanceSessionStatus {
  if (state === undefined) return AttendanceSessionStatus.CONNECTED;
  return AttendanceSessionStatus[state];
}

function fromAttendanceSessionStatus(
  status: AttendanceSessionStatus,
): NonNullable<AttendanceSessionRecord['connectionState']> {
  if (status === AttendanceSessionStatus.ACTIVE) return 'CONNECTED';
  if (status === AttendanceSessionStatus.INTERRUPTED) return 'DISCONNECTED';
  return status;
}

function toJson(value: Readonly<Record<string, unknown>>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function toRequestStatus(status: SessionRequestRecord['status']): RequestStatus {
  const statuses: Record<SessionRequestRecord['status'], RequestStatus> = {
    pending: RequestStatus.PENDING,
    accepted: RequestStatus.ACCEPTED,
    rejected: RequestStatus.REJECTED,
    expired: RequestStatus.EXPIRED,
    cancelled: RequestStatus.CANCELLED,
  };
  return statuses[status];
}

function fromRequestStatus(status: RequestStatus): SessionRequestRecord['status'] {
  return status.toLowerCase() as SessionRequestRecord['status'];
}

function toProfessorAvailability(
  availability: ProfessorRecord['availability'],
): ProfessorAvailability {
  if (availability === 'available') return ProfessorAvailability.AVAILABLE;
  if (availability === 'busy') return ProfessorAvailability.BUSY;
  return ProfessorAvailability.UNAVAILABLE;
}

function workflowProfessorAvailability(
  status: WorkflowPresenceRecord['status'],
): ProfessorAvailability {
  if (status === 'AVAILABLE') return ProfessorAvailability.AVAILABLE;
  if (status === 'BUSY') return ProfessorAvailability.BUSY;
  return ProfessorAvailability.UNAVAILABLE;
}

function toSeverity(severity: AuditRecord['severity']): AuditSeverity {
  if (severity === 'error') return AuditSeverity.ERROR;
  if (severity === 'warning') return AuditSeverity.WARNING;
  return AuditSeverity.INFO;
}

function toTransferDirection(direction: FileTransferRecord['direction']): FileTransferDirection {
  return direction === 'teacher-to-student'
    ? FileTransferDirection.TEACHER_TO_STUDENT
    : FileTransferDirection.STUDENT_TO_TEACHER;
}

function toTransferStatus(status: FileTransferRecord['status']): FileTransferStatus {
  const statuses: Record<FileTransferRecord['status'], FileTransferStatus> = {
    requested: FileTransferStatus.REQUESTED,
    accepted: FileTransferStatus.ACCEPTED,
    'in-progress': FileTransferStatus.IN_PROGRESS,
    completed: FileTransferStatus.COMPLETED,
    rejected: FileTransferStatus.REJECTED,
    cancelled: FileTransferStatus.CANCELLED,
    failed: FileTransferStatus.FAILED,
  };
  return statuses[status];
}
