import {
  CallStatus,
  EventType,
  RequestStatus,
  type Call,
  type CallId,
  type RequestId,
} from '@professor-connect/shared-types';

import type { StateTransition } from '../../core/state-machine/state-transition.js';
import type { CallManager } from './call.manager.js';
import type {
  AcceptedRequestReader,
  CallLifecycleEvent,
  CallLifecycleListener,
  CallLogger,
} from './call.types.js';

const silentLogger: CallLogger = {
  info(): void {},
  error(): void {},
};

export class CallService {
  private readonly lifecycleListeners = new Set<CallLifecycleListener>();

  public constructor(
    private readonly callManager: CallManager,
    private readonly requestReader: AcceptedRequestReader,
    private readonly logger: CallLogger = silentLogger,
  ) {}

  public createCall(requestId: RequestId, sessionId?: string): Call {
    const request = this.requestReader.findRequest(requestId);

    if (request === undefined) {
      throw new Error(`Request não encontrada: ${requestId}`);
    }

    if (request.status !== RequestStatus.ACCEPTED || request.teacherId === undefined) {
      throw new Error(`Request ainda não foi aceita: ${requestId}`);
    }

    const call = this.callManager.createCall({
      requestId,
      ...(sessionId === undefined ? {} : { sessionId }),
      studentId: request.studentId,
      teacherId: request.teacherId,
    });

    this.logger.info('Call criada', { callId: call.callId, requestId });
    this.emitLifecycle({ event: EventType.CALL_CREATED, call });

    return call;
  }

  public startCall(callId: CallId): Call {
    const call = this.callManager.startCall(callId);

    this.logger.info('Call iniciada', { callId });
    this.emitLifecycle({ event: EventType.CALL_CONNECTING, call });

    return call;
  }

  public connectCall(callId: CallId): Call {
    const call = this.callManager.connectCall(callId);

    this.emitLifecycle({ event: EventType.CALL_CONNECTED, call });

    return call;
  }

  public finishCall(callId: CallId): Call {
    const call = this.callManager.finishCall(callId);

    this.logger.info('Finalização', { callId });
    this.emitLifecycle({ event: EventType.CALL_FINISHED, call });

    return call;
  }

  public failCall(callId: CallId): Call {
    const call = this.callManager.failCall(callId);

    this.logger.info('Falha', { callId });
    this.emitLifecycle({ event: EventType.CALL_FAILED, call });

    return call;
  }

  public cancelCall(callId: CallId): Call {
    const call = this.callManager.cancelCall(callId);

    this.logger.info('Cancelamento', { callId });
    this.emitLifecycle({ event: EventType.CALL_CANCELLED, call });

    return call;
  }

  public associateSession(callId: CallId, sessionId: string): Call {
    return this.callManager.associateSession(callId, sessionId);
  }

  public findCall(callId: CallId): Call | undefined {
    return this.callManager.findCall(callId);
  }

  public listCalls(): readonly Call[] {
    return this.callManager.listCalls();
  }

  public listActiveCallsForClient(clientId: string): readonly Call[] {
    const terminalStatuses: ReadonlySet<CallStatus> = new Set([
      CallStatus.FINISHED,
      CallStatus.FAILED,
      CallStatus.CANCELLED,
    ]);

    return this.listCalls().filter(
      (call) =>
        !terminalStatuses.has(call.status) &&
        (call.studentId === clientId || call.teacherId === clientId),
    );
  }

  public removeCall(callId: CallId): boolean {
    return this.callManager.removeCall(callId);
  }

  public getStateHistory(callId: CallId): readonly StateTransition<Call['status']>[] {
    return this.callManager.getStateHistory(callId);
  }

  public onLifecycle(listener: CallLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);

    return () => this.lifecycleListeners.delete(listener);
  }

  private emitLifecycle(event: CallLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Falha ao emitir evento da Call', error);
      }
    }
  }
}
