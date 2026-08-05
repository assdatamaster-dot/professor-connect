import type { PrismaClient } from '@prisma/client';

import { assertMigrationsApplied, type DatabaseReadinessReport } from './migration-readiness.js';
import { PersistenceQueue, type PersistenceErrorHandler } from './persistence-queue.js';
import { prismaClient } from './prisma-client.js';
import {
  AttendanceSessionRepository,
  AuditRepository,
  FileTransferRepository,
  ProfessorRepository,
  RecoveryRepository,
  SessionRequestRepository,
  StudentRepository,
  WorkflowCallRepository,
  WorkflowPresenceRepository,
  WorkflowRequestRepository,
  WorkflowSessionRepository,
} from './repositories/persistence.repositories.js';

export class DatabasePersistence {
  public readonly professor;
  public readonly student;
  public readonly sessionRequest;
  public readonly attendanceSession;
  public readonly fileTransfer;
  public readonly audit;
  public readonly recovery;
  public readonly workflowPresence;
  public readonly workflowRequest;
  public readonly workflowCall;
  public readonly workflowSession;
  private readonly queue: PersistenceQueue;

  public constructor(
    private readonly prisma: PrismaClient = prismaClient,
    onError?: PersistenceErrorHandler,
  ) {
    this.queue = new PersistenceQueue(onError);
    this.professor = new ProfessorRepository(prisma, this.queue);
    this.student = new StudentRepository(prisma, this.queue);
    this.sessionRequest = new SessionRequestRepository(prisma, this.queue);
    this.attendanceSession = new AttendanceSessionRepository(prisma, this.queue);
    this.fileTransfer = new FileTransferRepository(prisma, this.queue);
    this.audit = new AuditRepository(prisma, this.queue);
    this.recovery = new RecoveryRepository(prisma);
    this.workflowPresence = new WorkflowPresenceRepository(prisma, this.queue);
    this.workflowRequest = new WorkflowRequestRepository(prisma, this.queue);
    this.workflowCall = new WorkflowCallRepository(prisma, this.queue);
    this.workflowSession = new WorkflowSessionRepository(prisma, this.queue);
  }

  public flush(): Promise<void> {
    return this.queue.flush();
  }

  public assertMigrationsApplied(): Promise<DatabaseReadinessReport> {
    return assertMigrationsApplied(this.prisma);
  }

  public disconnect(): Promise<void> {
    return this.prisma.$disconnect();
  }
}
