import { randomUUID } from 'node:crypto';

import { PresenceManager } from '../professor-presence/presence.manager.js';
import { StudentPresenceManager } from '../student-presence/student-presence.manager.js';
import type {
  SessionRequest,
  SessionRequestDelivery,
  SessionRequestExpirationHandler,
  SessionRequestManagerOptions,
  SessionRequestStatus,
} from './session-request.types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class SessionRequestManager {
  private readonly historyById = new Map<string, SessionRequest>();
  private readonly pendingById = new Map<string, SessionRequest>();
  private readonly expirationTimers = new Map<string, NodeJS.Timeout>();
  private readonly expirationHandlers = new Set<SessionRequestExpirationHandler>();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly timeoutMs: number;
  private readonly scheduler: (task: () => void, timeoutMs: number) => NodeJS.Timeout;
  private readonly persistence: SessionRequestManagerOptions['persistence'];
  private readonly audit: SessionRequestManagerOptions['audit'];

  public constructor(
    private readonly professorPresenceManager = new PresenceManager(),
    private readonly studentPresenceManager = new StudentPresenceManager(),
    options: SessionRequestManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? setTimeout;
    this.persistence = options.persistence;
    this.audit = options.audit;

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Timeout da solicitação deve ser um inteiro positivo');
    }

    for (const request of options.initialHistory ?? []) {
      this.historyById.set(request.requestId, request);
    }
  }

  public createRequest(studentSocketId: string, teacherId: string): SessionRequestDelivery {
    const student = this.studentPresenceManager.findStudentBySocketId(studentSocketId);
    if (student === undefined) {
      throw new Error('Aluno não está registrado ou online');
    }

    const teacher = this.professorPresenceManager.findProfessorById(teacherId);
    if (teacher === undefined) {
      throw new Error('Professor não está online');
    }
    if (teacher.availability !== 'available') {
      throw new Error('Professor indisponível. Escolha outro professor.');
    }
    if (
      (student.organizationId !== undefined || teacher.organizationId !== undefined) &&
      student.organizationId !== teacher.organizationId
    ) {
      throw new Error('Professor e aluno devem pertencer à mesma instituição');
    }
    if ([...this.pendingById.values()].some((request) => request.studentId === student.id)) {
      throw new Error('O aluno já possui uma solicitação pendente');
    }
    if ([...this.pendingById.values()].some((request) => request.teacherId === teacher.id)) {
      throw new Error('O professor já possui uma solicitação pendente');
    }

    const request: SessionRequest = {
      requestId: this.idFactory(),
      studentId: student.id,
      studentName: student.name,
      teacherId: teacher.id,
      teacherName: teacher.name,
      status: 'pending',
      createdAt: this.clock().toISOString(),
    };

    this.pendingById.set(request.requestId, request);
    this.historyById.set(request.requestId, request);
    this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'busy');
    this.persistence?.saveRequest(request);
    this.audit?.record({
      action: 'session-request.created',
      actorType: 'student',
      actorId: request.studentId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: {
        teacherId: request.teacherId,
        organizationId: student.organizationId ?? teacher.organizationId,
      },
    });
    const timer = this.scheduler(() => this.expireRequest(request.requestId), this.timeoutMs);
    timer.unref?.();
    this.expirationTimers.set(request.requestId, timer);

    return this.createDelivery(request);
  }

  public acceptRequest(requestId: string, teacherSocketId: string): SessionRequestDelivery {
    return this.completeRequest(requestId, teacherSocketId, 'accepted');
  }

  public rejectRequest(requestId: string, teacherSocketId: string): SessionRequestDelivery {
    return this.completeRequest(requestId, teacherSocketId, 'rejected');
  }

  public cancelRequest(requestId: string, studentSocketId: string): SessionRequestDelivery {
    const request = this.requirePendingRequest(requestId);
    const student = this.studentPresenceManager.findStudentBySocketId(studentSocketId);
    if (student?.id !== request.studentId) {
      throw new Error('Somente o aluno solicitante pode cancelar');
    }
    const cancelledRequest: SessionRequest = {
      ...request,
      status: 'cancelled',
      respondedAt: this.clock().toISOString(),
    };
    this.clearPendingRequest(requestId);
    this.historyById.set(requestId, cancelledRequest);
    this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'available');
    this.persistence?.saveRequest(cancelledRequest);
    this.audit?.record({
      action: 'session-request.cancelled',
      actorType: 'student',
      actorId: request.studentId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: { organizationId: student.organizationId },
    });
    return this.createDelivery(cancelledRequest);
  }

  public listPendingRequests(): readonly SessionRequest[] {
    return [...this.pendingById.values()];
  }

  public listHistory(): readonly SessionRequest[] {
    return [...this.historyById.values()];
  }

  public onExpired(handler: SessionRequestExpirationHandler): () => void {
    this.expirationHandlers.add(handler);
    return () => this.expirationHandlers.delete(handler);
  }

  public close(): void {
    for (const timer of this.expirationTimers.values()) {
      clearTimeout(timer);
    }
    this.expirationTimers.clear();
    this.expirationHandlers.clear();
  }

  private completeRequest(
    requestId: string,
    teacherSocketId: string,
    status: Extract<SessionRequestStatus, 'accepted' | 'rejected'>,
  ): SessionRequestDelivery {
    const request = this.requirePendingRequest(requestId);
    const teacher = this.professorPresenceManager.findProfessorBySocketId(teacherSocketId);

    if (teacher?.id !== request.teacherId) {
      throw new Error('Somente o professor solicitado pode responder');
    }
    if (status === 'accepted' && teacher.availability === 'unavailable') {
      throw new Error('Professor indisponível. Escolha outro professor.');
    }
    if (
      status === 'accepted' &&
      this.studentPresenceManager.findStudentById(request.studentId) === undefined
    ) {
      throw new Error('Aluno solicitante não está mais online');
    }

    const completedRequest = { ...request, status, respondedAt: this.clock().toISOString() };
    this.clearPendingRequest(requestId);
    this.historyById.set(requestId, completedRequest);
    if (status === 'rejected') {
      this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'available');
    }
    this.persistence?.saveRequest(completedRequest);
    this.audit?.record({
      action: `session-request.${status}`,
      actorType: 'professor',
      actorId: request.teacherId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: { organizationId: teacher.organizationId },
    });
    return this.createDelivery(completedRequest);
  }

  private expireRequest(requestId: string): void {
    const request = this.pendingById.get(requestId);
    if (request === undefined) {
      return;
    }

    const expiredRequest: SessionRequest = {
      ...request,
      status: 'expired',
      respondedAt: this.clock().toISOString(),
    };
    this.clearPendingRequest(requestId);
    this.historyById.set(requestId, expiredRequest);
    this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'available');
    this.persistence?.saveRequest(expiredRequest);
    this.audit?.record({
      action: 'session-request.expired',
      entityType: 'session-request',
      entityId: request.requestId,
      severity: 'warning',
      metadata: {
        organizationId: this.studentPresenceManager.findStudentById(request.studentId)
          ?.organizationId,
      },
    });
    const delivery = this.createDelivery(expiredRequest);

    for (const handler of this.expirationHandlers) {
      handler(delivery);
    }
  }

  private requirePendingRequest(requestId: string): SessionRequest {
    const request = this.pendingById.get(requestId);
    if (request === undefined) {
      throw new Error(`Solicitação pendente não encontrada: ${requestId}`);
    }
    return request;
  }

  private clearPendingRequest(requestId: string): void {
    const timer = this.expirationTimers.get(requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    this.expirationTimers.delete(requestId);
    this.pendingById.delete(requestId);
  }

  private createDelivery(request: SessionRequest): SessionRequestDelivery {
    return {
      request,
      studentSocketId: this.studentPresenceManager.findStudentById(request.studentId)?.socketId,
      teacherSocketId: this.professorPresenceManager.findProfessorById(request.teacherId)?.socketId,
    };
  }
}
