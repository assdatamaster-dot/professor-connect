import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RemoteKeyboardControllerPort } from '../main/remote-keyboard/remote-keyboard.controller.js';
import { InputPermissions } from '../main/remote-input/input-permissions.js';
import { RemoteInputController } from '../main/remote-input/remote-input.controller.js';
import type { RemoteMouseControllerPort } from '../main/remote-mouse/remote-mouse.controller.js';

const REFERENCE = { sessionId: 'session-id', requestId: 'request-id' };

test('a autorização central protege mouse e teclado e encerra ambos imediatamente', () => {
  const mouse = new FakeMouseController();
  const keyboard = new FakeKeyboardController();
  const controller = new RemoteInputController(mouse, keyboard);

  assert.throws(
    () =>
      controller.receiveKeyboard(REFERENCE, {
        type: 'keydown',
        key: 'a',
        code: 'KeyA',
        repeat: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
      }),
    /sem autorização ativa/,
  );

  controller.start(REFERENCE);
  assert.equal(controller.isActive(), true);
  controller.receiveMouse(REFERENCE, {
    type: 'mousemove',
    x: 0.5,
    y: 0.5,
    button: 0,
    buttons: 0,
  });
  controller.receiveKeyboard(REFERENCE, {
    type: 'keydown',
    key: 'a',
    code: 'KeyA',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
  });

  controller.stop();
  assert.equal(controller.isActive(), false);
  assert.equal(mouse.stops, 1);
  assert.equal(keyboard.stops, 1);
  assert.throws(
    () =>
      controller.receiveMouse(REFERENCE, {
        type: 'mousemove',
        x: 0.5,
        y: 0.5,
        button: 0,
        buttons: 0,
      }),
    /sem autorização ativa/,
  );
});

test('continua encerrando os dois controladores mesmo quando um deles falha', () => {
  const mouse = new FakeMouseController();
  const keyboard = new FakeKeyboardController();
  mouse.throwOnStop = true;
  keyboard.throwOnStop = true;
  const controller = new RemoteInputController(mouse, keyboard, new InputPermissions(), {
    info(): void {},
    error(): void {},
  });
  controller.start(REFERENCE);

  assert.doesNotThrow(() => controller.stop());
  assert.equal(mouse.stops, 1);
  assert.equal(keyboard.stops, 1);
  assert.equal(controller.isActive(), false);
});

class FakeMouseController implements RemoteMouseControllerPort {
  public active = false;
  public stops = 0;
  public throwOnStop = false;

  public start(): void {
    this.active = true;
  }

  public receive(): 'MouseMove' {
    return 'MouseMove';
  }

  public stop(): void {
    this.active = false;
    this.stops += 1;
    if (this.throwOnStop) {
      throw new Error('mouse stop failure');
    }
  }

  public isActive(): boolean {
    return this.active;
  }
}

class FakeKeyboardController implements RemoteKeyboardControllerPort {
  public active = false;
  public stops = 0;
  public throwOnStop = false;

  public start(): void {
    this.active = true;
  }

  public receive(): readonly string[] {
    return ['KeyDown: a'];
  }

  public stop(): void {
    this.active = false;
    this.stops += 1;
    if (this.throwOnStop) {
      throw new Error('keyboard stop failure');
    }
  }

  public isActive(): boolean {
    return this.active;
  }
}
