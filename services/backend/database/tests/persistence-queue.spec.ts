import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PersistenceQueue } from '../src/persistence-queue.js';

test('serializa gravações para preservar a ordem das relações', async () => {
  const order: number[] = [];
  const queue = new PersistenceQueue();
  queue.enqueue(async () => {
    await Promise.resolve();
    order.push(1);
  });
  queue.enqueue(async () => {
    order.push(2);
  });

  await queue.flush();
  assert.deepEqual(order, [1, 2]);
});

test('propaga falhas no flush sem impedir operações posteriores', async () => {
  const errors: unknown[] = [];
  const order: number[] = [];
  const queue = new PersistenceQueue((error) => errors.push(error));
  queue.enqueue(async () => {
    throw new Error('falha esperada');
  });
  queue.enqueue(async () => {
    order.push(2);
  });

  await assert.rejects(queue.flush(), AggregateError);
  assert.equal(errors.length, 1);
  assert.deepEqual(order, [2]);
});
