import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('oferece cadastro, login e perfil próprios do aluno', async () => {
  const html = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8');

  assert.match(html, /id="authentication-form"/);
  assert.match(html, /id="student-register-form"/);
  assert.match(html, /id="student-profile-dialog"/);
  assert.match(html, /id="teacher-list"/);
  assert.match(html, /id="request-confirmation-dialog"/);
  assert.match(html, /id="student-history-dialog"/);
  assert.match(html, /Seu perfil será criado como aluno/);
  assert.doesNotMatch(html, /authentication-organization/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
});
