import assert from 'node:assert/strict';
import { test } from 'node:test';

import { approveRemoteControlWithScreen } from '../renderer/remote-control-permission-flow.js';

test('compartilha todos os monitores antes de aprovar o controle remoto', async () => {
  let sharing = false;
  const actions: string[] = [];

  const snapshot = await approveRemoteControlWithScreen({
    isScreenSharing: () => sharing,
    startScreenShare: async () => {
      actions.push('share');
      sharing = true;
    },
    approveRemoteControl: async () => {
      actions.push('approve');
      return { status: 'active' };
    },
  });

  assert.deepEqual(actions, ['share', 'approve']);
  assert.deepEqual(snapshot, { status: 'active' });
});

test('não aprova se o compartilhamento de todos os monitores falhar', async () => {
  let approvalCalled = false;

  await assert.rejects(
    approveRemoteControlWithScreen({
      isScreenSharing: () => false,
      startScreenShare: async () => undefined,
      approveRemoteControl: async () => {
        approvalCalled = true;
      },
    }),
    /Não foi possível compartilhar todos os monitores/,
  );
  assert.equal(approvalCalled, false);
});

test('aprova imediatamente quando a tela já está compartilhada', async () => {
  let shareCalled = false;

  await approveRemoteControlWithScreen({
    isScreenSharing: () => true,
    startScreenShare: async () => {
      shareCalled = true;
    },
    approveRemoteControl: async () => undefined,
  });

  assert.equal(shareCalled, false);
});
