import type { Call, CallId, RequestId } from '@professor-connect/protocol';
import type { WorkflowCallPersistence } from '../../persistence/persistence.types.js';

export class CallStore {
  private readonly calls = new Map<CallId, Call>();

  public constructor(private readonly persistence?: WorkflowCallPersistence) {}

  public createCall(call: Call): Call {
    if (this.calls.has(call.callId)) {
      throw new Error(`Call já existente: ${call.callId}`);
    }

    if (this.findByRequestId(call.requestId) !== undefined) {
      throw new Error(`Request já possui uma Call: ${call.requestId}`);
    }

    this.calls.set(call.callId, call);
    this.persistence?.saveWorkflowCall(call);

    return call;
  }

  public findCall(callId: CallId): Call | undefined {
    return this.calls.get(callId);
  }

  public findByRequestId(requestId: RequestId): Call | undefined {
    return this.listCalls().find((call) => call.requestId === requestId);
  }

  public updateCall(call: Call): Call {
    if (!this.calls.has(call.callId)) {
      throw new Error(`Call não encontrada: ${call.callId}`);
    }

    this.calls.set(call.callId, call);
    this.persistence?.saveWorkflowCall(call);

    return call;
  }

  public removeCall(callId: CallId): boolean {
    const call = this.calls.get(callId);
    if (call !== undefined) {
      this.persistence?.saveWorkflowCall(call);
    }
    return this.calls.delete(callId);
  }

  public listCalls(): readonly Call[] {
    return [...this.calls.values()];
  }
}
