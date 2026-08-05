import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { toUserFacingErrorMessage } from '../renderer/error-message.js';

test('oferece cadastro, login e perfil próprios do professor', async () => {
  const html = await readFile(new URL('../renderer/presence.html', import.meta.url), 'utf8');

  assert.match(html, /id="login-form"/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /id="profile-dialog"/);
  assert.match(html, /id="availability-toggle"/);
  assert.match(html, /id="teacher-history-dialog"/);
  assert.match(html, /Criar conta de professor/);
  assert.doesNotMatch(html, /login-organization/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
});

test('remove detalhes internos do Electron das mensagens de autenticação', () => {
  const error = new Error(
    "Error invoking remote method 'teacher:auth:login': Error: Credenciais inválidas",
  );

  assert.equal(toUserFacingErrorMessage(error, 'Falha de autenticação'), 'Credenciais inválidas');
  assert.equal(
    toUserFacingErrorMessage('erro desconhecido', 'Falha de autenticação'),
    'Falha de autenticação',
  );
});
