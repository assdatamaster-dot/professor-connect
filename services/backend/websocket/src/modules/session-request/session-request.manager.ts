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

  public constructor(
    private readonly professorPresenceManager = new PresenceManager(),
    private readonly studentPresenceManager = new StudentPresenceManager(),
    options: SessionRequestManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? setTimeout;

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Timeout da solicitação deve ser um inteiro positivo');
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

    const completedRequest = { ...request, status };
    this.clearPendingRequest(requestId);
    this.historyById.set(requestId, completedRequest);
    return this.createDelivery(completedRequest);
  }

  private expireRequest(requestId: string): void {
    const request = this.pendingById.get(requestId);
    if (request === undefined) {
      return;
    }

    const expiredRequest: SessionRequest = { ...request, status: 'expired' };
    this.clearPendingRequest(requestId);
    this.historyById.set(requestId, expiredRequest);
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
