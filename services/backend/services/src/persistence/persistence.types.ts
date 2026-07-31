import type {
  Call,
  RequestId,
  ServiceRequest,
  Session,
  ClientPresence,
} from '@professor-connect/protocol';

export interface WorkflowPresencePersistence {
  savePresence(client: ClientPresence): void;
}

export interface WorkflowRequestPersistence {
  saveWorkflowRequest(request: ServiceRequest, recipientTeacherIds?: readonly string[]): void;
  recordWorkflowRejection(requestId: RequestId, teacherId: string): void;
}

export interface WorkflowCallPersistence {
  saveWorkflowCall(call: Call): void;
}

export interface WorkflowSessionPersistence {
  saveWorkflowSession(session: Session): void;
  removeWorkflowSession(sessionId: string): void;
}

export interface WorkflowPersistence {
  readonly presence?: WorkflowPresencePersistence;
  readonly request?: WorkflowRequestPersistence;
  readonly call?: WorkflowCallPersistence;
  readonly session?: WorkflowSessionPersistence;
}
