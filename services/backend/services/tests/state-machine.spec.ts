import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RequestStatus } from '@professor-connect/protocol';

import {
  InvalidStateTransitionError,
  RequestStateMachine,
  StateMachine,
  type StateMachineLogger,
  type StateTransition,
} from '../src/index.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const TRANSITION_TIMESTAMP = '2026-07-20T12:00:00.000Z';
const REQUEST_STATES = Object.values(RequestStatus);
const VALID_TARGETS = [
  RequestStatus.ACCEPTED,
  RequestStatus.REJECTED,
  RequestStatus.CANCELLED,
  RequestStatus.EXPIRED,
] as const;

test('permite todas as transições válidas de Request', () => {
  for (const targetState of VALID_TARGETS) {
    const machine = new RequestStateMachine(REQUEST_ID, RequestStatus.PENDING, {
      clock: () => new Date(TRANSITION_TIMESTAMP),
    });

    const transition = machine.transitionTo(targetState);

    assert.equal(machine.getCurrentState(), targetState);
    assert.equal(transition.previousState, RequestStatus.PENDING);
    assert.equal(transition.nextState, targetState);
    assert.equal(transition.timestamp, TRANSITION_TIMESTAMP);
  }
});

test('rejeita todas as transições não declaradas com erro controlado', () => {
  let invalidTransitionCount = 0;

  for (const previousState of REQUEST_STATES) {
    for (const nextState of REQUEST_STATES) {
      const isValid =
        previousState === RequestStatus.PENDING &&
        VALID_TARGETS.some((targetState) => targetState === nextState);

      if (isValid) {
        continue;
      }

      invalidTransitionCount += 1;
      const machine = new RequestStateMachine(REQUEST_ID, previousState);

      assert.throws(
        () => machine.transitionTo(nextState),
        (error: unknown) => {
          assert(error instanceof InvalidStateTransitionError);
          assert.equal(error.code, 'INVALID_STATE_TRANSITION');
          assert.equal(error.previousState, previousState);
          assert.equal(error.nextState, nextState);
          return true;
        },
      );
      assert.equal(machine.getCurrentState(), previousState);
      assert.deepEqual(machine.getHistory(), []);
    }
  }

  assert.equal(invalidTransitionCount, 21);
});

test('registra histórico e emite evento somente para mudança válida', () => {
  const transitions: StateTransition<RequestStatus>[] = [];
  const machine = new RequestStateMachine(REQUEST_ID, RequestStatus.PENDING, {
    clock: () => new Date(TRANSITION_TIMESTAMP),
  });
  const unsubscribe = machine.onTransition((transition) => transitions.push(transition));

  machine.accept();
  unsubscribe();

  const historyEntry = machine.getHistory()[0];
  assert(historyEntry !== undefined);
  assert.equal(historyEntry.previousState, RequestStatus.PENDING);
  assert.equal(historyEntry.nextState, RequestStatus.ACCEPTED);
  assert.equal(historyEntry.timestamp, TRANSITION_TIMESTAMP);
  assert.deepEqual(transitions, machine.getHistory());
  assert.throws(() => machine.expire(), InvalidStateTransitionError);
  assert.equal(transitions.length, 1);
  assert.equal(machine.getHistory().length, 1);
});

test('registra mudanças válidas e tentativas inválidas no logger', () => {
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const logger: StateMachineLogger = {
    info(message): void {
      infoMessages.push(message);
    },
    error(message): void {
      errorMessages.push(message);
    },
  };
  const validMachine = new RequestStateMachine(REQUEST_ID, RequestStatus.PENDING, { logger });
  const invalidMachine = new RequestStateMachine(REQUEST_ID, RequestStatus.EXPIRED, { logger });

  validMachine.cancel();
  assert.throws(() => invalidMachine.accept(), InvalidStateTransitionError);

  assert.deepEqual(infoMessages, ['Mudança de estado', 'Tentativa inválida']);
  assert.deepEqual(errorMessages, ['Erro de transição']);
});

test('StateMachine permanece genérica para outros domínios', () => {
  type ExampleState = 'IDLE' | 'RUNNING' | 'FINISHED';

  const machine = new StateMachine<ExampleState>('IDLE', [
    { from: 'IDLE', to: 'RUNNING' },
    { from: 'RUNNING', to: 'FINISHED' },
  ]);

  machine.transitionTo('RUNNING');
  machine.transitionTo('FINISHED');

  assert.equal(machine.getCurrentState(), 'FINISHED');
  assert.equal(machine.getHistory().length, 2);
});
