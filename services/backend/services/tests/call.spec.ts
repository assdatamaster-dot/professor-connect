import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CallStatus,
  EventType,
  RequestStatus,
  type RequestId,
  type ServiceRequest,
} from '@professor-connect/protocol';

import {
  CallManager,
  CallService,
  CallStateMachine,
  CallStore,
  InvalidStateTransitionError,
  type AcceptedRequestReader,
  type CallLifecycleEvent,
  type CallLogger,
} from '../src/index.js';

const CALL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID: RequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STUDENT_ID = 'student-1';
const TEACHER_ID = 'teacher-1';
const TIMESTAMPS = [
  '2026-07-20T12:00:00.000Z',
  '2026-07-20T12:00:01.000Z',
  '2026-07-20T12:00:02.000Z',
  '2026-07-20T12:00:03.000Z',
] as const;
const FINAL_TIMESTAMP = TIMESTAMPS[3];
const CALL_STATES = Object.values(CallStatus);
const VALID_TRANSITIONS = new Set([
  `${CallStatus.CREATED}:${CallStatus.CONNECTING}`,
  `${CallStatus.CREATED}:${CallStatus.CANCELLED}`,
  `${CallStatus.CREATED}:${CallStatus.FAILED}`,
  `${CallStatus.CONNECTING}:${CallStatus.CONNECTED}`,
  `${CallStatus.CONNECTING}:${CallStatus.FAILED}`,
  `${CallStatus.CONNECTING}:${CallStatus.CANCELLED}`,
  `${CallStatus.CONNECTED}:${CallStatus.FINISHED}`,
]);

test('cria, associa Session, conecta e finaliza uma Call', () => {
  const fixture = createFixture();
  const lifecycleEvents: CallLifecycleEvent[] = [];
  fixture.service.onLifecycle((event) => lifecycleEvents.push(event));

  const createdCall = fixture.service.createCall(REQUEST_ID);
  const callWithSession = fixture.service.associateSession(createdCall.callId, SESSION_ID);
  const connectingCall = fixture.service.startCall(createdCall.callId);
  const connectedCall = fixture.service.connectCall(createdCall.callId);
  const finishedCall = fixture.service.finishCall(createdCall.callId);

  assert.equal(createdCall.status, CallStatus.CREATED);
  assert.equal(createdCall.requestId, REQUEST_ID);
  assert.equal(createdCall.studentId, STUDENT_ID);
  assert.equal(createdCall.teacherId, TEACHER_ID);
  assert.equal(callWithSession.sessionId, SESSION_ID);
  assert.equal(connectingCall.status, CallStatus.CONNECTING);
  assert.equal(connectedCall.status, CallStatus.CONNECTED);
  assert.equal(connectedCall.connectedAt, TIMESTAMPS[2]);
  assert.equal(finishedCall.status, CallStatus.FINISHED);
  assert.equal(finishedCall.finishedAt, TIMESTAMPS[3]);
  assert.deepEqual(
    fixture.service
      .getStateHistory(createdCall.callId)
      .map((transition) => [transition.previousState, transition.nextState]),
    [
      [CallStatus.CREATED, CallStatus.CONNECTING],
      [CallStatus.CONNECTING, CallStatus.CONNECTED],
      [CallStatus.CONNECTED, CallStatus.FINISHED],
    ],
  );
  assert.deepEqual(
    lifecycleEvents.map((event) => event.event),
    [
      EventType.CALL_CREATED,
      EventType.CALL_CONNECTING,
      EventType.CALL_CONNECTED,
      EventType.CALL_FINISHED,
    ],
  );
  assert.equal(fixture.service.listCalls().length, 1);
  assert.equal(fixture.service.removeCall(createdCall.callId), true);
  assert.equal(fixture.service.findCall(createdCall.callId), undefined);
  assert(fixture.infoMessages.includes('Call criada'));
  assert(fixture.infoMessages.includes('Call iniciada'));
  assert(fixture.infoMessages.includes('Finalização'));
  assert.equal(countMessage(fixture.infoMessages, 'Mudança de estado'), 3);
});

test('permite falha a partir de CREATED e CONNECTING', () => {
  for (const shouldStart of [false, true]) {
    const fixture = createFixture();
    const call = fixture.service.createCall(REQUEST_ID);

    if (shouldStart) {
      fixture.service.startCall(call.callId);
    }

    const failedCall = fixture.service.failCall(call.callId);

    assert.equal(failedCall.status, CallStatus.FAILED);
    assert(failedCall.finishedAt !== undefined);
    assert(fixture.infoMessages.includes('Falha'));
  }
});

test('permite cancelamento a partir de CREATED e CONNECTING', () => {
  for (const shouldStart of [false, true]) {
    const fixture = createFixture();
    const call = fixture.service.createCall(REQUEST_ID);

    if (shouldStart) {
      fixture.service.startCall(call.callId);
    }

    const cancelledCall = fixture.service.cancelCall(call.callId);

    assert.equal(cancelledCall.status, CallStatus.CANCELLED);
    assert(cancelledCall.finishedAt !== undefined);
    assert(fixture.infoMessages.includes('Cancelamento'));
  }
});

test('rejeita todas as transições de Call não declaradas', () => {
  let invalidTransitionCount = 0;

  for (const previousState of CALL_STATES) {
    for (const nextState of CALL_STATES) {
      if (VALID_TRANSITIONS.has(`${previousState}:${nextState}`)) {
        continue;
      }

      invalidTransitionCount += 1;
      const machine = new CallStateMachine(CALL_ID, previousState);

      assert.throws(
        () => machine.transitionTo(nextState),
        (error: unknown) => {
          assert(error instanceof InvalidStateTransitionError);
          assert.equal(error.previousState, previousState);
          assert.equal(error.nextState, nextState);
          return true;
        },
      );
      assert.equal(machine.getCurrentState(), previousState);
      assert.equal(machine.getHistory().length, 0);
    }
  }

  assert.equal(invalidTransitionCount, 29);
});

interface CallFixture {
  readonly service: CallService;
  readonly infoMessages: string[];
}

function createFixture(): CallFixture {
  let timestampIndex = 0;
  const infoMessages: string[] = [];
  const logger: CallLogger = {
    info(message): void {
      infoMessages.push(message);
    },
    error(_message, error): void {
      throw error;
    },
  };
  const request: ServiceRequest = {
    requestId: REQUEST_ID,
    studentId: STUDENT_ID,
    teacherId: TEACHER_ID,
    status: RequestStatus.ACCEPTED,
    createdAt: TIMESTAMPS[0],
    acceptedAt: TIMESTAMPS[0],
    expiresAt: TIMESTAMPS[3],
  };
  const requestReader: AcceptedRequestReader = {
    findRequest(requestId): ServiceRequest | undefined {
      return requestId === request.requestId ? request : undefined;
    },
  };
  const manager = new CallManager(new CallStore(), {
    clock: () => {
      const timestamp = TIMESTAMPS[timestampIndex] ?? FINAL_TIMESTAMP;
      timestampIndex += 1;
      return new Date(timestamp);
    },
    idFactory: () => CALL_ID,
    stateMachineLogger: logger,
  });

  return {
    service: new CallService(manager, requestReader, logger),
    infoMessages,
  };
}

function countMessage(messages: readonly string[], expectedMessage: string): number {
  return messages.filter((message) => message === expectedMessage).length;
}
