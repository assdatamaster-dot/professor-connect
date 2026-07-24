import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RemoteKeyboardController,
  resolveNativeKey,
} from '../main/remote-keyboard/remote-keyboard.controller.js';
import { identifyShortcut } from '../main/remote-input/input-events.js';
import type {
  NativeKeyboardKey,
  RemoteKeyboardAdapter,
} from '../main/remote-keyboard/remote-keyboard.types.js';

const REFERENCE = { sessionId: 'session-id', requestId: 'request-id' };

test('executa letras, números, teclas especiais e libera teclas pressionadas ao encerrar', () => {
  const adapter = new RecordingKeyboardAdapter();
  const controller = new RemoteKeyboardController(adapter);
  controller.start(REFERENCE);

  controller.receive(keyEvent('keydown', 'a', 'KeyA'));
  controller.receive(keyEvent('keyup', 'a', 'KeyA'));
  controller.receive(keyEvent('keydown', '7', 'Digit7'));
  controller.receive(keyEvent('keyup', '7', 'Digit7'));
  controller.receive(keyEvent('keydown', 'Backspace', 'Backspace'));
  controller.receive(keyEvent('keyup', 'Backspace', 'Backspace'));
  controller.receive(keyEvent('keydown', 'Enter', 'Enter'));
  controller.receive(keyEvent('keyup', 'Enter', 'Enter'));
  controller.receive(keyEvent('keydown', 'Shift', 'ShiftLeft', { shiftKey: true }));

  assert.deepEqual(
    adapter.downs.map(({ code }) => code),
    ['KeyA', 'Digit7', 'Backspace', 'Enter', 'ShiftLeft'],
  );
  assert.deepEqual(
    adapter.ups.map(({ code }) => code),
    ['KeyA', 'Digit7', 'Backspace', 'Enter'],
  );

  controller.stop();
  assert.equal(controller.isActive(), false);
  assert.equal(adapter.ups.at(-1)?.code, 'ShiftLeft');
});

test('identifica atalhos e ignora Ctrl+Alt+Delete sem gerar erro', () => {
  const adapter = new RecordingKeyboardAdapter();
  const controller = new RemoteKeyboardController(adapter);
  controller.start(REFERENCE);

  controller.receive(keyEvent('keydown', 'Control', 'ControlLeft', { ctrlKey: true }));
  const copyLogs = controller.receive(keyEvent('keydown', 'c', 'KeyC', { ctrlKey: true }));
  controller.receive(keyEvent('keyup', 'c', 'KeyC', { ctrlKey: true }));
  controller.receive(keyEvent('keydown', 'Alt', 'AltLeft', { ctrlKey: true, altKey: true }));
  const secureAttentionLogs = controller.receive(
    keyEvent('keydown', 'Delete', 'Delete', { ctrlKey: true, altKey: true }),
  );
  controller.receive(keyEvent('keyup', 'Delete', 'Delete', { ctrlKey: true, altKey: true }));

  assert(copyLogs.includes('Shortcut: Ctrl+C'));
  assert(
    secureAttentionLogs.includes(
      'Shortcut: Ctrl+Alt+Delete (não suportado pelo sistema operacional)',
    ),
  );
  assert(!adapter.downs.some(({ code }) => code === 'Delete'));
  assert(!adapter.ups.some(({ code }) => code === 'Delete'));
  assert.equal(controller.isActive(), true);
});

test('suporta Ctrl+Shift+Esc e keypress não duplica a injeção', () => {
  const adapter = new RecordingKeyboardAdapter();
  const controller = new RemoteKeyboardController(adapter);
  controller.start(REFERENCE);

  controller.receive(keyEvent('keydown', 'Control', 'ControlLeft', { ctrlKey: true }));
  controller.receive(keyEvent('keydown', 'Shift', 'ShiftLeft', { ctrlKey: true, shiftKey: true }));
  const logs = controller.receive(
    keyEvent('keydown', 'Escape', 'Escape', { ctrlKey: true, shiftKey: true }),
  );
  controller.receive(keyEvent('keypress', 'a', 'KeyA'));

  assert(logs.includes('Shortcut: Ctrl+Shift+Esc'));
  assert.deepEqual(
    adapter.downs.map(({ code }) => code),
    ['ControlLeft', 'ShiftLeft', 'Escape'],
  );
});

test('mapeia todas as teclas declaradas como suportadas', () => {
  const codes = [
    'KeyZ',
    'Digit0',
    'Numpad9',
    'Space',
    'Backspace',
    'Delete',
    'Tab',
    'Enter',
    'NumpadEnter',
    'Escape',
    'ShiftRight',
    'ControlRight',
    'AltRight',
    'MetaLeft',
  ];
  for (const code of codes) {
    assert.equal(resolveNativeKey(code).code, code);
  }
  assert.throws(() => resolveNativeKey('F24'), /Tecla não suportada/);
});

test('identifica toda a lista de atalhos autorizados', () => {
  const shortcuts = {
    KeyC: 'Ctrl+C',
    KeyV: 'Ctrl+V',
    KeyX: 'Ctrl+X',
    KeyA: 'Ctrl+A',
    KeyZ: 'Ctrl+Z',
    KeyY: 'Ctrl+Y',
    KeyS: 'Ctrl+S',
    KeyF: 'Ctrl+F',
    KeyP: 'Ctrl+P',
    KeyN: 'Ctrl+N',
    KeyO: 'Ctrl+O',
  };
  for (const [code, expected] of Object.entries(shortcuts)) {
    assert.equal(
      identifyShortcut(keyEvent('keydown', code.at(-1) ?? '', code, { ctrlKey: true }))?.name,
      expected,
    );
  }
});

function keyEvent(
  type: 'keydown' | 'keyup' | 'keypress',
  key: string,
  code: string,
  modifiers: Partial<{
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
  }> = {},
) {
  return {
    type,
    key,
    code,
    repeat: false,
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  } as const;
}

class RecordingKeyboardAdapter implements RemoteKeyboardAdapter {
  public readonly downs: NativeKeyboardKey[] = [];
  public readonly ups: NativeKeyboardKey[] = [];

  public keyDown(key: NativeKeyboardKey): void {
    this.downs.push(key);
  }

  public keyUp(key: NativeKeyboardKey): void {
    this.ups.push(key);
  }
}
