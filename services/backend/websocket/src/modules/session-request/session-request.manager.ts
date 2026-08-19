import { randomUUID } from 'node:crypto';

import { PresenceManager } from '../professor-presence/presence.manager.js';
import { StudentPresenceManager } from '../student-presence/student-presence.manager.js';
import { estimateQueueWaitMinutes } from './session-request.types.js';
import type {
  SessionQueueChangedHandler,
  SessionQueueEntry,
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
  private readonly queueChangedHandlers = new Set<SessionQueueChangedHandler>();
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
      if (request.status === 'pending') {
        this.pendingById.set(request.requestId, request);
        if (request.queuedAt === undefined) this.scheduleExpiration(request);
      }
    }
  }

  public createRequest(studentSocketId: string, teacherId: string): SessionRequestDelivery {
    const student = this.studentPresenceManager.findStudentBySocketId(studentSocketId);
    if (student === undefined) throw new Error('Aluno não está registrado ou online');

    const teacher = this.professorPresenceManager.findProfessorById(teacherId);
    if (teacher === undefined) throw new Error('Professor não está online');
    if (teacher.availability === 'unavailable') {
      throw new Error('Professor indisponível. Escolha outro professor.');
    }
    if (
      (student.organizationId !== undefined || teacher.organizationId !== undefined) &&
      student.organizationId !== teacher.organizationId
    ) {
      throw new Error('Professor e aluno devem pertencer à mesma instituição');
    }
    if (this.findPendingRequestForStudent(student.id) !== undefined) {
      throw new Error('O aluno já possui uma solicitação pendente');
    }

    const createdAt = this.clock().toISOString();
    const queued = teacher.availability === 'busy';
    const request: SessionRequest = {
      requestId: this.idFactory(),
      studentId: student.id,
      studentName: student.name,
      teacherId: teacher.id,
      teacherName: teacher.name,
      status: 'pending',
      createdAt,
      ...(queued ? { queuedAt: createdAt } : {}),
    };

    this.pendingById.set(request.requestId, request);
    this.historyById.set(request.requestId, request);
    this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'busy');
    this.persistence?.saveRequest(request);
    this.audit?.record({
      action: queued ? 'session-request.queued' : 'session-request.created',
      actorType: 'student',
      actorId: request.studentId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: {
        teacherId: request.teacherId,
        organizationId: student.organizationId ?? teacher.organizationId,
      },
    });
    if (!queued) this.scheduleExpiration(request);
    this.notifyQueueChanged(request.teacherId);
    return this.createDelivery(request);
  }

  public acceptRequest(requestId: string, teacherSocketId: string): SessionRequestDelivery {
    const teacher = this.professorPresenceManager.findProfessorBySocketId(teacherSocketId);
    const request = this.requirePendingRequest(requestId);
    if (teacher?.id !== request.teacherId) {
      throw new Error('Somente o professor solicitado pode responder');
    }
    return this.completeRequest(request, 'accepted', teacher.organizationId);
  }

  public acceptNextRequest(teacherId: string): SessionRequestDelivery | undefined {
    const teacher = this.professorPresenceManager.findProfessorById(teacherId);
    if (teacher === undefined || teacher.availability === 'unavailable') return undefined;

    for (const request of this.getPendingRequestsForTeacher(teacherId)) {
      if (this.studentPresenceManager.findStudentById(request.studentId) !== undefined) {
        return this.completeRequest(request, 'accepted', teacher.organizationId);
      }
      this.transitionWithoutActor(request, 'expired');
    }
    return undefined;
  }

  public rejectRequest(requestId: string, teacherSocketId: string): SessionRequestDelivery {
    const teacher = this.professorPresenceManager.findProfessorBySocketId(teacherSocketId);
    const request = this.requirePendingRequest(requestId);
    if (teacher?.id !== request.teacherId) {
      throw new Error('Somente o professor solicitado pode responder');
    }
    return this.completeRequest(request, 'rejected', teacher.organizationId);
  }

  public cancelRequest(requestId: string, studentSocketId: string): SessionRequestDelivery {
    const request = this.requirePendingRequest(requestId);
    const student = this.studentPresenceManager.findStudentBySocketId(studentSocketId);
    if (student?.id !== request.studentId) {
      throw new Error('Somente o aluno solicitante pode cancelar');
    }
    const delivery = this.transitionWithoutActor(request, 'cancelled');
    this.audit?.record({
      action: 'session-request.cancelled',
      actorType: 'student',
      actorId: request.studentId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: { organizationId: student.organizationId },
    });
    return delivery;
  }

  public listPendingRequests(): readonly SessionRequest[] {
    return [...this.pendingById.values()].sort(compareRequests);
  }

  public listHistory(): readonly SessionRequest[] {
    return [...this.historyById.values()];
  }

  public getQueueForTeacher(teacherId: string): readonly SessionQueueEntry[] {
    const requests = this.getPendingRequestsForTeacher(teacherId);
    const teacherOnline = this.professorPresenceManager.findProfessorById(teacherId) !== undefined;
    return requests.map((request, index) => ({
      requestId: request.requestId,
      studentId: request.studentId,
      studentName: request.studentName,
      teacherId: request.teacherId,
      teacherName: request.teacherName,
      status: 'waiting',
      position: index + 1,
      studentsAhead: index,
      totalWaiting: requests.length,
      estimatedWaitMinutes: estimateQueueWaitMinutes(index + 1),
      createdAt: request.createdAt,
      ...(request.queuedAt === undefined ? {} : { queuedAt: request.queuedAt }),
      mode: request.queuedAt === undefined ? 'direct' : 'queued',
      teacherOnline,
    }));
  }

  public getQueueForStudent(studentId: string): SessionQueueEntry | undefined {
    const request = this.findPendingRequestForStudent(studentId);
    if (request === undefined) return undefined;
    return this.getQueueForTeacher(request.teacherId).find(
      (entry) => entry.requestId === request.requestId,
    );
  }

  public synchronizeProfessorQueue(teacherId: string): readonly SessionQueueEntry[] {
    const queue = this.getQueueForTeacher(teacherId);
    if (queue.length > 0) {
      this.professorPresenceManager.setAvailabilityByProfessorId(teacherId, 'busy');
    }
    return this.getQueueForTeacher(teacherId);
  }

  public releaseProfessorIfQueueEmpty(teacherId: string): void {
    if (this.getPendingRequestsForTeacher(teacherId).length === 0) {
      this.professorPresenceManager.setAvailabilityByProfessorId(teacherId, 'available');
    }
  }

  public onExpired(handler: SessionRequestExpirationHandler): () => void {
    this.expirationHandlers.add(handler);
    return () => this.expirationHandlers.delete(handler);
  }

  public onQueueChanged(handler: SessionQueueChangedHandler): () => void {
    this.queueChangedHandlers.add(handler);
    return () => this.queueChangedHandlers.delete(handler);
  }

  public close(): void {
    for (const timer of this.expirationTimers.values()) clearTimeout(timer);
    this.expirationTimers.clear();
    this.expirationHandlers.clear();
    this.queueChangedHandlers.clear();
  }

  private completeRequest(
    request: SessionRequest,
    status: Extract<SessionRequestStatus, 'accepted' | 'rejected'>,
    organizationId?: string,
  ): SessionRequestDelivery {
    const first = this.getPendingRequestsForTeacher(request.teacherId)[0];
    if (first?.requestId !== request.requestId) {
      throw new Error('A fila deve ser atendida em ordem de chegada');
    }
    if (
      status === 'accepted' &&
      this.studentPresenceManager.findStudentById(request.studentId) === undefined
    ) {
      throw new Error('Aluno solicitante não está mais online');
    }

    const completedRequest: SessionRequest = {
      ...request,
      status,
      respondedAt: this.clock().toISOString(),
    };
    this.clearPendingRequest(request.requestId);
    this.historyById.set(request.requestId, completedRequest);
    if (
      status === 'rejected' &&
      this.getPendingRequestsForTeacher(request.teacherId).length === 0
    ) {
      this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'available');
    }
    this.persistence?.saveRequest(completedRequest);
    this.audit?.record({
      action: `session-request.${status}`,
      actorType: 'professor',
      actorId: request.teacherId,
      entityType: 'session-request',
      entityId: request.requestId,
      metadata: { organizationId },
    });
    this.notifyQueueChanged(request.teacherId);
    return this.createDelivery(completedRequest);
  }

  private transitionWithoutActor(
    request: SessionRequest,
    status: Extract<SessionRequestStatus, 'cancelled' | 'expired'>,
  ): SessionRequestDelivery {
    const completed: SessionRequest = {
      ...request,
      status,
      respondedAt: this.clock().toISOString(),
    };
    this.clearPendingRequest(request.requestId);
    this.historyById.set(request.requestId, completed);
    if (
      request.queuedAt === undefined &&
      this.getPendingRequestsForTeacher(request.teacherId).length === 0
    ) {
      this.professorPresenceManager.setAvailabilityByProfessorId(request.teacherId, 'available');
    }
    this.persistence?.saveRequest(completed);
    if (status === 'expired') {
      this.audit?.record({
        action: 'session-request.expired',
        entityType: 'session-request',
        entityId: request.requestId,
        severity: 'warning',
      });
    }
    this.notifyQueueChanged(request.teacherId);
    return this.createDelivery(completed);
  }

  private expireRequest(requestId: string): void {
    const request = this.pendingById.get(requestId);
    if (request === undefined) return;
    const delivery = this.transitionWithoutActor(request, 'expired');
    for (const handler of this.expirationHandlers) handler(delivery);
  }

  private scheduleExpiration(request: SessionRequest): void {
    const elapsed = Math.max(0, this.clock().getTime() - Date.parse(request.createdAt));
    const timer = this.scheduler(
      () => this.expireRequest(request.requestId),
      Math.max(1, this.timeoutMs - elapsed),
    );
    timer.unref?.();
    this.expirationTimers.set(request.requestId, timer);
  }

  private requirePendingRequest(requestId: string): SessionRequest {
    const request = this.pendingById.get(requestId);
    if (request === undefined) {
      throw new Error(`Solicitação pendente não encontrada: ${requestId}`);
    }
    return request;
  }

  private findPendingRequestForStudent(studentId: string): SessionRequest | undefined {
    return this.listPendingRequests().find((request) => request.studentId === studentId);
  }

  private getPendingRequestsForTeacher(teacherId: string): readonly SessionRequest[] {
    return this.listPendingRequests().filter((request) => request.teacherId === teacherId);
  }

  private clearPendingRequest(requestId: string): void {
    const timer = this.expirationTimers.get(requestId);
    if (timer !== undefined) clearTimeout(timer);
    this.expirationTimers.delete(requestId);
    this.pendingById.delete(requestId);
  }

  private notifyQueueChanged(teacherId: string): void {
    const queue = this.getQueueForTeacher(teacherId);
    for (const handler of this.queueChangedHandlers) handler(teacherId, queue);
  }

  private createDelivery(request: SessionRequest): SessionRequestDelivery {
    const queue =
      request.status === 'pending' ? this.getQueueForStudent(request.studentId) : undefined;
    return {
      request,
      studentSocketId: this.studentPresenceManager.findStudentById(request.studentId)?.socketId,
      teacherSocketId: this.professorPresenceManager.findProfessorById(request.teacherId)?.socketId,
      ...(queue === undefined ? {} : { queue }),
    };
  }
}

function compareRequests(left: SessionRequest, right: SessionRequest): number {
  const createdDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return createdDifference === 0
    ? left.requestId.localeCompare(right.requestId)
    : createdDifference;
}
