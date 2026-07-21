import { randomUUID } from 'node:crypto';

import { CallStatus, type Call, type CallId } from '@professor-connect/protocol';

import type { StateTransition } from '../../core/state-machine/state-transition.js';
import { CallStateMachine } from './call.state-machine.js';
import type { CallStore } from './call.store.js';
import type { CallClock, CallCreation, CallIdFactory, CallManagerOptions } from './call.types.js';

export class CallManager {
  private readonly stateMachines = new Map<CallId, CallStateMachine>();
  private readonly idFactory: CallIdFactory;
  private readonly clock: CallClock;
  private readonly stateMachineLogger: CallManagerOptions['stateMachineLogger'];

  public constructor(
    private readonly callStore: CallStore,
    options: CallManagerOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.stateMachineLogger = options.stateMachineLogger;
  }

  public createCall(creation: CallCreation): Call {
    const callId = this.idFactory();
    const call: Call = {
      callId,
      requestId: creation.requestId,
      ...(creation.sessionId === undefined ? {} : { sessionId: creation.sessionId }),
      studentId: creation.studentId,
      teacherId: creation.teacherId,
      status: CallStatus.CREATED,
      createdAt: this.clock().toISOString(),
    };
    const createdCall = this.callStore.createCall(call);

    this.stateMachines.set(
      callId,
      new CallStateMachine(callId, CallStatus.CREATED, {
        clock: this.clock,
        ...(this.stateMachineLogger === undefined ? {} : { logger: this.stateMachineLogger }),
      }),
    );

    return createdCall;
  }

  public startCall(callId: CallId): Call {
    return this.applyTransition(callId, this.requireStateMachine(callId).start());
  }

  public connectCall(callId: CallId): Call {
    const transition = this.requireStateMachine(callId).connect();

    return this.applyTransition(callId, transition, { connectedAt: transition.timestamp });
  }

  public finishCall(callId: CallId): Call {
    const transition = this.requireStateMachine(callId).finish();

    return this.applyTransition(callId, transition, { finishedAt: transition.timestamp });
  }

  public failCall(callId: CallId): Call {
    const transition = this.requireStateMachine(callId).fail();

    return this.applyTransition(callId, transition, { finishedAt: transition.timestamp });
  }

  public cancelCall(callId: CallId): Call {
    const transition = this.requireStateMachine(callId).cancel();

    return this.applyTransition(callId, transition, { finishedAt: transition.timestamp });
  }

  public associateSession(callId: CallId, sessionId: string): Call {
    if (sessionId.trim().length === 0) {
      throw new Error('sessionId é obrigatório');
    }

    return this.callStore.updateCall({ ...this.requireCall(callId), sessionId });
  }

  public findCall(callId: CallId): Call | undefined {
    return this.callStore.findCall(callId);
  }

  public listCalls(): readonly Call[] {
    return this.callStore.listCalls();
  }

  public removeCall(callId: CallId): boolean {
    const removed = this.callStore.removeCall(callId);

    if (removed) {
      this.stateMachines.delete(callId);
    }

    return removed;
  }

  public getStateHistory(callId: CallId): readonly StateTransition<CallStatus>[] {
    return this.requireStateMachine(callId).getHistory();
  }

  private applyTransition(
    callId: CallId,
    transition: StateTransition<CallStatus>,
    timestamps: Readonly<Pick<Call, 'connectedAt' | 'finishedAt'>> = {},
  ): Call {
    return this.callStore.updateCall({
      ...this.requireCall(callId),
      ...timestamps,
      status: transition.nextState,
    });
  }

  private requireCall(callId: CallId): Call {
    const call = this.findCall(callId);

    if (call === undefined) {
      throw new Error(`Call não encontrada: ${callId}`);
    }

    return call;
  }

  private requireStateMachine(callId: CallId): CallStateMachine {
    const stateMachine = this.stateMachines.get(callId);

    if (stateMachine === undefined) {
      throw new Error(`Máquina de estados não encontrada para a Call: ${callId}`);
    }

    return stateMachine;
  }
}
