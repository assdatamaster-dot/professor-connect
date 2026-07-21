import { randomUUID } from 'node:crypto';

import { RequestStatus, type RequestId, type ServiceRequest } from '@professor-connect/protocol';

import type { StateTransition } from '../../core/state-machine/state-transition.js';
import { RequestStateMachine } from './request-state-machine.js';
import type { RequestStore } from './request.store.js';
import type { RequestClock, RequestIdFactory, RequestManagerOptions } from './request.types.js';

export class RequestManager {
  private readonly stateMachines = new Map<RequestId, RequestStateMachine>();
  private readonly idFactory: RequestIdFactory;
  private readonly clock: RequestClock;
  private readonly stateMachineLogger: RequestManagerOptions['stateMachineLogger'];

  public constructor(
    private readonly requestStore: RequestStore,
    options: RequestManagerOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.stateMachineLogger = options.stateMachineLogger;
  }

  public createRequest(
    studentId: string,
    recipientTeacherIds: readonly string[],
    timeoutMilliseconds: number,
  ): ServiceRequest {
    const createdAt = this.clock();
    const requestId = this.idFactory();
    const request: ServiceRequest = {
      requestId,
      studentId,
      status: RequestStatus.PENDING,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + timeoutMilliseconds).toISOString(),
    };

    const createdRequest = this.requestStore.createRequest(request, recipientTeacherIds);

    this.stateMachines.set(
      requestId,
      new RequestStateMachine(requestId, RequestStatus.PENDING, {
        clock: this.clock,
        ...(this.stateMachineLogger === undefined ? {} : { logger: this.stateMachineLogger }),
      }),
    );

    return createdRequest;
  }

  public acceptRequest(requestId: RequestId, teacherId: string): ServiceRequest {
    const request = this.requireRequest(requestId);
    this.requireRecipientTeacher(requestId, teacherId);

    if (this.requestStore.hasTeacherRejected(requestId, teacherId)) {
      throw new Error(`Professor já rejeitou a solicitação: ${teacherId}`);
    }

    const transition = this.requireStateMachine(requestId).accept();

    return this.requestStore.updateRequest({
      ...request,
      teacherId,
      status: transition.nextState,
      acceptedAt: transition.timestamp,
    });
  }

  public rejectRequest(requestId: RequestId, teacherId: string): ServiceRequest {
    const request = this.requireRequest(requestId);

    if (request.status !== RequestStatus.PENDING) {
      this.requireStateMachine(requestId).reject();
    }

    this.requireRecipientTeacher(requestId, teacherId);
    this.requestStore.recordTeacherRejection(requestId, teacherId);

    return request;
  }

  public cancelRequest(requestId: RequestId, studentId: string): ServiceRequest {
    const request = this.requireRequest(requestId);

    if (request.studentId !== studentId) {
      throw new Error('Somente o aluno solicitante pode cancelar a solicitação');
    }

    const transition = this.requireStateMachine(requestId).cancel();

    return this.requestStore.updateRequest({
      ...request,
      status: transition.nextState,
    });
  }

  public expireRequest(requestId: RequestId): ServiceRequest | undefined {
    const request = this.findRequest(requestId);

    if (request === undefined) {
      return undefined;
    }

    const transition = this.requireStateMachine(requestId).expire();

    return this.requestStore.updateRequest({
      ...request,
      status: transition.nextState,
    });
  }

  public findRequest(requestId: RequestId): ServiceRequest | undefined {
    return this.requestStore.findRequest(requestId);
  }

  public listRequests(): readonly ServiceRequest[] {
    return this.requestStore.listRequests();
  }

  public listActiveRequests(): readonly ServiceRequest[] {
    return this.requestStore.listActiveRequests();
  }

  public getRecipientTeacherIds(requestId: RequestId): readonly string[] {
    return this.requestStore.getRecipientTeacherIds(requestId);
  }

  public getRejectedTeacherIds(requestId: RequestId): readonly string[] {
    return this.requestStore.getRejectedTeacherIds(requestId);
  }

  public getStateHistory(requestId: RequestId): readonly StateTransition<RequestStatus>[] {
    return this.requireStateMachine(requestId).getHistory();
  }

  private requireRequest(requestId: RequestId): ServiceRequest {
    const request = this.findRequest(requestId);

    if (request === undefined) {
      throw new Error(`Solicitação não encontrada: ${requestId}`);
    }

    return request;
  }

  private requireStateMachine(requestId: RequestId): RequestStateMachine {
    const stateMachine = this.stateMachines.get(requestId);

    if (stateMachine === undefined) {
      throw new Error(`Máquina de estados não encontrada para a solicitação: ${requestId}`);
    }

    return stateMachine;
  }

  private requireRecipientTeacher(requestId: RequestId, teacherId: string): void {
    if (!this.requestStore.hasTeacherReceived(requestId, teacherId)) {
      throw new Error(`Professor não recebeu a solicitação: ${teacherId}`);
    }
  }
}
