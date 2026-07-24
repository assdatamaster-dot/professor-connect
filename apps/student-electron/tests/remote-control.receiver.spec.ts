import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RemoteControlReceiver } from '../main/remote-control.receiver.js';
import type {
  RemoteMouseControllerPort,
  RemoteMouseEventLog,
} from '../main/remote-mouse/remote-mouse.controller.js';

const SESSION_ID = 'session-id';
const REQUEST_ID = 'request-id';

test('executa entradas somente após autorização e registra teclado', () => {
  let sequence = 0;
  const mouseController = new FakeMouseController();
  const receiver = new RemoteControlReceiver({
    clock: () => new Date(`2026-07-23T15:00:0${sequence}.000Z`),
    idFactory: () => `log-${++sequence}`,
    mouseController,
  });

  assert.throws(
    () =>
      receiver.receiveMouse({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        event: { type: 'mousemove', x: 0.5, y: 0.5, button: 0, buttons: 0 },
      }),
    /sem autorização ativa/,
  );

  receiver.receiveRequest({ sessionId: SESSION_ID, requestId: REQUEST_ID }, SESSION_ID);
  assert.deepEqual(receiver.approve(SESSION_ID), {
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
  });
  assert.equal(mouseController.started, true);

  receiver.receiveMouse({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: { type: 'mousemove', x: 0.25, y: 0.75, button: 0, buttons: 0 },
  });
  receiver.receiveMouse({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: { type: 'mousedown', x: 0.25, y: 0.75, button: 0, buttons: 1 },
  });
  receiver.receiveMouse({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: { type: 'mouseup', x: 0.25, y: 0.75, button: 0, buttons: 0 },
  });
  receiver.receiveMouse({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: {
      type: 'wheel',
      x: 0.25,
      y: 0.75,
      button: 0,
      buttons: 0,
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
    },
  });
  receiver.receiveKeyboard({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: {
      type: 'keydown',
      key: 'a',
      code: 'KeyA',
      repeat: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
    },
  });

  assert.deepEqual(
    receiver.getSnapshot().logs.map(({ message }) => message),
    [
      'Solicitação recebida',
      'Solicitação aceita',
      'Controle iniciado',
      'Evento recebido: MouseMove',
      'Evento recebido: ClickLeft',
      'Evento recebido: Wheel',
      'Evento recebido: KeyDown: a',
    ],
  );
  assert.deepEqual(mouseController.receivedTypes, ['mousemove', 'mousedown', 'mouseup', 'wheel']);
  assert.deepEqual(receiver.stop(SESSION_ID), {
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    reason: 'participant',
  });
  assert.equal(mouseController.started, false);
  assert.equal(receiver.getSnapshot().logs.at(-1)?.message, 'Controle encerrado');
});

test('erro do sistema operacional encerra e gera stop sincronizável', () => {
  const mouseController = new FakeMouseController();
  const receiver = new RemoteControlReceiver({ mouseController });
  receiver.receiveRequest({ sessionId: SESSION_ID, requestId: REQUEST_ID }, SESSION_ID);
  receiver.approve(SESSION_ID);
  mouseController.failure = new Error('SendInput falhou');

  const stopped = receiver.receiveMouse({
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
    event: { type: 'mousemove', x: 0.5, y: 0.5, button: 0, buttons: 0 },
  });

  assert.equal(stopped?.reason, 'execution-error');
  assert.equal(receiver.getSnapshot().status, 'inactive');
  assert(
    receiver
      .getSnapshot()
      .logs.some(({ message }) => message === 'Erro de execução: SendInput falhou'),
  );
});

test('nega solicitação e mantém o canal inativo', () => {
  const receiver = new RemoteControlReceiver();
  receiver.receiveRequest({ sessionId: SESSION_ID, requestId: REQUEST_ID }, SESSION_ID);
  assert.deepEqual(receiver.deny(SESSION_ID), {
    sessionId: SESSION_ID,
    requestId: REQUEST_ID,
  });
  assert.equal(receiver.getSnapshot().status, 'inactive');
  assert.equal(receiver.getSnapshot().logs.at(-1)?.message, 'Solicitação negada');
});

class FakeMouseController implements RemoteMouseControllerPort {
  public started = false;
  public failure: Error | undefined;
  public readonly receivedTypes: string[] = [];

  public start(): void {
    this.started = true;
  }

  public receive(event: { readonly type: string }): RemoteMouseEventLog {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    this.receivedTypes.push(event.type);
    if (event.type === 'mousemove') {
      return 'MouseMove';
    }
    if (event.type === 'mouseup') {
      return 'ClickLeft';
    }
    if (event.type === 'wheel') {
      return 'Wheel';
    }
    return undefined;
  }

  public stop(): void {
    this.started = false;
  }

  public isActive(): boolean {
    return this.started;
  }
}
