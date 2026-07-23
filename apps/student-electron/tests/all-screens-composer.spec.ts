import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateCompositeSize } from '../renderer/all-screens-composer.js';

test('preserva o tamanho de um desktop virtual dentro do limite', () => {
  assert.deepEqual(calculateCompositeSize(3200, 1080), { width: 3200, height: 1080 });
});

test('reduz proporcionalmente um desktop virtual muito largo', () => {
  assert.deepEqual(calculateCompositeSize(7680, 2160), { width: 3840, height: 1080 });
});

test('recusa dimensões inválidas', () => {
  assert.throws(() => calculateCompositeSize(0, 1080), /Dimensões do desktop virtual/);
});
