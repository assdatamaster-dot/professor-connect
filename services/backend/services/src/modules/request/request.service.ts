import {
  ClientRole,
  PresenceStatus,
  RequestStatus,
  type ClientPresence,
  type RequestId,
  type ServiceRequest,
} from '@professor-connect/protocol';

import type { StateTransition } from '../../core/state-machine/state-transition.js';
import type { PresenceService } from '../presence/presence.service.js';
import type { RequestManager } from './request.manager.js';
import type {
  RequestDelivery,
  RequestExpirationHandler,
  RequestRejection,
  RequestScheduler,
  ScheduledRequestTask,
} from './request.types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

const scheduleRequest: RequestScheduler = (task, delayMilliseconds) => {
  const timeout = setTimeout(task, delayMilliseconds);

  return {
    cancel(): void {
      clearTimeout(timeout);
    },
  };
};

export class RequestService {
  private readonly expirationHandlers = new Set<RequestExpirationHandler>();
  private readonly expirationTasks = new Map<RequestId, ScheduledRequestTask>();

  public constructor(
    private readonly requestManager: RequestManager,
    private readonly presenceService: PresenceService,
    private readonly timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly scheduler: RequestScheduler = scheduleRequest,
  ) {
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
      throw new Error('Timeout de solicitação deve ser um inteiro positivo');
    }
  }

  public createRequest(connectionId: string): RequestDelivery {
    const student = this.requireClientWithRole(connectionId, ClientRole.STUDENT);
    const availableTeachers = this.presenceService.listAvailableTeachers();
    const request = this.requestManager.createRequest(
      student.clientId,
      availableTeachers.map((teacher) => teacher.clientId),
      this.timeoutMilliseconds,
    );

    this.expirationTasks.set(
      request.requestId,
      this.scheduler(() => this.expireRequest(request.requestId), this.timeoutMilliseconds),
    );

    return {
      request,
      studentConnectionId: student.connectionId,
      teacherConnectionIds: availableTeachers.map((teacher) => teacher.connectionId),
    };
  }

  public acceptRequest(connectionId: string, requestId: RequestId): RequestDelivery {
    const teacher = this.requireClientWithRole(connectionId, ClientRole.TEACHER);
    const request = this.requestManager.acceptRequest(requestId, teacher.clientId);

    this.cancelExpiration(requestId);

    return this.createDelivery(request);
  }

  public rejectRequest(connectionId: string, requestId: RequestId): RequestRejection {
    const teacher = this.requireClientWithRole(connectionId, ClientRole.TEACHER);
    const request = this.requestManager.rejectRequest(requestId, teacher.clientId);

    return {
      request,
      teacherId: teacher.clientId,
      teacherConnectionId: teacher.connectionId,
    };
  }

  public cancelRequest(connectionId: string, requestId: RequestId): RequestDelivery {
    const student = this.requireClientWithRole(connectionId, ClientRole.STUDENT);
    const request = this.requestManager.cancelRequest(requestId, student.clientId);

    this.cancelExpiration(requestId);

    return this.createDelivery(request);
  }

  public findRequest(requestId: RequestId): ServiceRequest | undefined {
    return this.requestManager.findRequest(requestId);
  }

  public listRequests(): readonly ServiceRequest[] {
    return this.requestManager.listRequests();
  }

  public listActiveRequests(): readonly ServiceRequest[] {
    return this.requestManager.listActiveRequests();
  }

  public listPendingRequestsForClient(clientId: string): readonly ServiceRequest[] {
    return this.listActiveRequests().filter(
      (request) =>
        request.studentId === clientId ||
        this.requestManager.getRecipientTeacherIds(request.requestId).includes(clientId),
    );
  }

  public getRejectedTeacherIds(requestId: RequestId): readonly string[] {
    return this.requestManager.getRejectedTeacherIds(requestId);
  }

  public getStateHistory(requestId: RequestId): readonly StateTransition<RequestStatus>[] {
    return this.requestManager.getStateHistory(requestId);
  }

  public onExpired(handler: RequestExpirationHandler): () => void {
    this.expirationHandlers.add(handler);

    return () => this.expirationHandlers.delete(handler);
  }

  public close(): void {
    for (const task of this.expirationTasks.values()) {
      task.cancel();
    }

    this.expirationTasks.clear();
    this.expirationHandlers.clear();
  }

  private expireRequest(requestId: RequestId): void {
    this.expirationTasks.delete(requestId);

    if (this.findRequest(requestId)?.status !== RequestStatus.PENDING) {
      return;
    }

    const request = this.requestManager.expireRequest(requestId);

    if (request === undefined) {
      return;
    }

    const delivery = this.createDelivery(request);

    for (const handler of this.expirationHandlers) {
      handler(delivery);
    }
  }

  private cancelExpiration(requestId: RequestId): void {
    this.expirationTasks.get(requestId)?.cancel();
    this.expirationTasks.delete(requestId);
  }

  private createDelivery(request: ServiceRequest): RequestDelivery {
    return {
      request,
      studentConnectionId: this.resolveConnectionId(request.studentId),
      teacherConnectionIds: this.requestManager
        .getRecipientTeacherIds(request.requestId)
        .map((teacherId) => this.resolveConnectionId(teacherId))
        .filter((connectionId): connectionId is string => connectionId !== undefined),
    };
  }

  private resolveConnectionId(clientId: string): string | undefined {
    const client = this.presenceService.findClient(clientId);

    return client?.status === PresenceStatus.OFFLINE ? undefined : client?.connectionId;
  }

  private requireClientWithRole(connectionId: string, role: ClientRole): ClientPresence {
    const client = this.presenceService.findByConnectionId(connectionId);

    if (client === undefined) {
      throw new Error(`Presença não registrada para a conexão: ${connectionId}`);
    }

    if (client.role !== role) {
      throw new Error(`Evento permitido somente para clientes ${role}`);
    }

    return client;
  }
}
