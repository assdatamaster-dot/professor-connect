import {
  RequestStatus,
  type RequestId,
  type ServiceRequest,
} from '@professor-connect/shared-types';

export class RequestStore {
  private readonly requests = new Map<RequestId, ServiceRequest>();
  private readonly recipientTeacherIds = new Map<RequestId, ReadonlySet<string>>();
  private readonly rejectedTeacherIds = new Map<RequestId, Set<string>>();

  public createRequest(request: ServiceRequest, teacherIds: readonly string[]): ServiceRequest {
    if (this.requests.has(request.requestId)) {
      throw new Error(`Solicitação já existente: ${request.requestId}`);
    }

    this.requests.set(request.requestId, request);
    this.recipientTeacherIds.set(request.requestId, new Set(teacherIds));
    this.rejectedTeacherIds.set(request.requestId, new Set());

    return request;
  }

  public findRequest(requestId: RequestId): ServiceRequest | undefined {
    return this.requests.get(requestId);
  }

  public updateRequest(request: ServiceRequest): ServiceRequest {
    if (!this.requests.has(request.requestId)) {
      throw new Error(`Solicitação não encontrada: ${request.requestId}`);
    }

    this.requests.set(request.requestId, request);

    return request;
  }

  public listRequests(): readonly ServiceRequest[] {
    return [...this.requests.values()];
  }

  public listActiveRequests(): readonly ServiceRequest[] {
    return this.listRequests().filter((request) => request.status === RequestStatus.PENDING);
  }

  public getRecipientTeacherIds(requestId: RequestId): readonly string[] {
    return [...(this.recipientTeacherIds.get(requestId) ?? [])];
  }

  public hasTeacherReceived(requestId: RequestId, teacherId: string): boolean {
    return this.recipientTeacherIds.get(requestId)?.has(teacherId) ?? false;
  }

  public recordTeacherRejection(requestId: RequestId, teacherId: string): void {
    const rejectedTeachers = this.rejectedTeacherIds.get(requestId);

    if (rejectedTeachers === undefined) {
      throw new Error(`Solicitação não encontrada: ${requestId}`);
    }

    if (rejectedTeachers.has(teacherId)) {
      throw new Error(`Professor já rejeitou a solicitação: ${teacherId}`);
    }

    rejectedTeachers.add(teacherId);
  }

  public hasTeacherRejected(requestId: RequestId, teacherId: string): boolean {
    return this.rejectedTeacherIds.get(requestId)?.has(teacherId) ?? false;
  }

  public getRejectedTeacherIds(requestId: RequestId): readonly string[] {
    return [...(this.rejectedTeacherIds.get(requestId) ?? [])];
  }
}
