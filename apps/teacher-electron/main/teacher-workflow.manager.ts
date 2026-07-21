import type {
  WorkflowEventListener,
  WorkflowManagerPort,
  WorkflowStartInput,
  WorkflowStateListener,
} from '@professor-connect/engine';

import type { TeacherAttendanceRequest, TeacherStudent } from '../shared/contracts.js';

export interface TeacherWorkflowManagerPort {
  connect(): Promise<void>;
  getOnlineStudents(): readonly TeacherStudent[];
  getPendingRequests(): readonly TeacherAttendanceRequest[];
  acceptRequest(requestId: string): Promise<void>;
  rejectRequest(requestId: string): Promise<void>;
  requestScreenSharing(): Promise<void>;
  requestRemoteControl(): Promise<void>;
  endAttendance(): Promise<void>;
  onEvent(listener: WorkflowEventListener): () => void;
  onStateChanged(listener: WorkflowStateListener): () => void;
}

export interface TeacherWorkflowManagerOptions {
  readonly teacher: WorkflowStartInput['teacher'];
  readonly onlineStudents: readonly TeacherStudent[];
  readonly requests: readonly TeacherAttendanceRequest[];
}

export class TeacherWorkflowManager implements TeacherWorkflowManagerPort {
  private readonly requests = new Map<string, TeacherAttendanceRequest>();
  private isConnected = false;

  public constructor(
    private readonly workflow: WorkflowManagerPort,
    private readonly options: TeacherWorkflowManagerOptions,
  ) {
    for (const request of options.requests) {
      this.requests.set(request.requestId, request);
    }
  }

  public async connect(): Promise<void> {
    this.isConnected = true;
    await Promise.resolve();
  }

  public getOnlineStudents(): readonly TeacherStudent[] {
    return this.isConnected ? [...this.options.onlineStudents] : [];
  }

  public getPendingRequests(): readonly TeacherAttendanceRequest[] {
    if (!this.isConnected) {
      return [];
    }
    return [...this.requests.values()];
  }

  public async acceptRequest(requestId: string): Promise<void> {
    const request = this.requireRequest(requestId);
    const student = this.options.onlineStudents.find(
      ({ studentId }) => studentId === request.studentId,
    );

    if (student === undefined) {
      throw new Error('Aluno da solicitação não está online');
    }

    await this.workflow.begin({
      student: {
        clientId: student.studentId,
        connectionId: `${student.studentId}-electron`,
        displayName: student.displayName,
      },
      teacher: this.options.teacher,
    });
    await this.workflow.accept();
    this.requests.delete(requestId);
  }

  public async rejectRequest(requestId: string): Promise<void> {
    this.requireRequest(requestId);
    this.requests.delete(requestId);
    await Promise.resolve();
  }

  public requestScreenSharing(): Promise<void> {
    return this.workflow.startScreenSharing();
  }

  public requestRemoteControl(): Promise<void> {
    return this.workflow.authorizeRemoteControl();
  }

  public async endAttendance(): Promise<void> {
    await this.workflow.end();
  }

  public onEvent(listener: WorkflowEventListener): () => void {
    return this.workflow.onEvent(listener);
  }

  public onStateChanged(listener: WorkflowStateListener): () => void {
    return this.workflow.onStateChanged(listener);
  }

  private requireRequest(requestId: string): TeacherAttendanceRequest {
    const request = this.requests.get(requestId);

    if (request === undefined) {
      throw new Error('Solicitação de atendimento não encontrada');
    }
    return request;
  }
}
