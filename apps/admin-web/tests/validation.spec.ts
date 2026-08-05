import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSlug, initials, isValidEmail, validatePassword } from '../src/validation.js';

test('validação de senha exige todos os grupos de segurança', () => {
  assert.equal(validatePassword('curta').valid, false);
  assert.equal(validatePassword('abcdefghijk1#').valid, false);
  assert.equal(validatePassword('Abcdefghijk#').valid, false);
  assert.equal(validatePassword('Abcdefghijk1').valid, false);
  assert.equal(validatePassword('Abcdefghi1#').valid, true);
});

test('avatar de iniciais usa no máximo dois nomes', () => {
  assert.equal(initials('  Ana   Maria Souza '), 'AM');
  assert.equal(initials('João'), 'J');
});

test('validação de e-mail rejeita valores incompletos', () => {
  assert.equal(isValidEmail('admin@instituicao.edu.br'), true);
  assert.equal(isValidEmail('admin@'), false);
});

test('slug do bootstrap é gerado sem acentos ou separadores inválidos', () => {
  assert.equal(createSlug('  Colégio São José / Unidade 1  '), 'colegio-sao-jose-unidade-1');
});
