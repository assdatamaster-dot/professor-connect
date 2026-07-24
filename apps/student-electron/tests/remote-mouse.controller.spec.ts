import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mapNormalizedPoint,
  RemoteMouseController,
} from '../main/remote-mouse/remote-mouse.controller.js';
import type {
  RemoteMouseAdapter,
  RemoteMouseButton,
} from '../main/remote-mouse/remote-mouse.types.js';

test('converte coordenadas normalizadas para monitor 4K com escala e offset', () => {
  assert.deepEqual(
    mapNormalizedPoint(0.5, 0.5, {
      left: 1920,
      top: -2160,
      width: 3840,
      height: 2160,
      sourceName: 'Monitor 4K',
    }),
    { x: 3840, y: -1080 },
  );
});

test('evita posicionar o mouse em lacunas entre monitores', () => {
  assert.deepEqual(
    mapNormalizedPoint(0.5, 0.25, {
      left: 0,
      top: 0,
      width: 2000,
      height: 1000,
      sourceName: '2 monitores',
      regions: [
        { left: 0, top: 0, width: 1000, height: 500 },
        { left: 1000, top: 500, width: 1000, height: 500 },
      ],
    }),
    { x: 999, y: 250 },
  );
});

test('move, clica, rola e libera botão pressionado ao encerrar', () => {
  const adapter = new RecordingMouseAdapter();
  const controller = new RemoteMouseController(adapter, {
    getBounds: () => ({
      left: 0,
      top: 0,
      width: 2560,
      height: 1440,
      sourceName: 'Monitor QHD',
    }),
  });
  controller.start({ sessionId: 'session', requestId: 'request' });

  assert.equal(
    controller.receive({ type: 'mousemove', x: 1, y: 1, button: 0, buttons: 0 }),
    'MouseMove',
  );
  controller.receive({ type: 'mousedown', x: 0.5, y: 0.5, button: 2, buttons: 2 });
  assert.equal(
    controller.receive({ type: 'mouseup', x: 0.5, y: 0.5, button: 2, buttons: 0 }),
    'ClickRight',
  );
  controller.receive({
    type: 'wheel',
    x: 0.5,
    y: 0.5,
    button: 0,
    buttons: 0,
    deltaX: 0,
    deltaY: 100,
    deltaMode: 0,
  });
  controller.receive({ type: 'mousedown', x: 0.5, y: 0.5, button: 0, buttons: 1 });
  controller.stop();

  assert.deepEqual(adapter.moves[0], { x: 2559, y: 1439 });
  assert.deepEqual(adapter.downs, ['right', 'left']);
  assert.deepEqual(adapter.ups, ['right', 'left']);
  assert.deepEqual(adapter.scrolls, [{ horizontal: 0, vertical: -120 }]);
  assert.equal(controller.isActive(), false);
});

test('executa todos os movimentos e limita somente logs e renders redundantes', () => {
  let now = 0;
  const adapter = new RecordingMouseAdapter();
  const controller = new RemoteMouseController(
    adapter,
    {
      getBounds: () => ({
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        sourceName: 'Monitor',
      }),
    },
    { info(): void {}, error(): void {} },
    () => now,
    250,
  );
  controller.start({ sessionId: 'session', requestId: 'request' });

  assert.equal(
    controller.receive({ type: 'mousemove', x: 0.1, y: 0.1, button: 0, buttons: 0 }),
    'MouseMove',
  );
  now = 100;
  assert.equal(
    controller.receive({ type: 'mousemove', x: 0.2, y: 0.2, button: 0, buttons: 0 }),
    undefined,
  );
  now = 250;
  assert.equal(
    controller.receive({ type: 'mousemove', x: 0.3, y: 0.3, button: 0, buttons: 0 }),
    'MouseMove',
  );

  assert.equal(adapter.moves.length, 3, 'a execução do mouse não é limitada');
});

class RecordingMouseAdapter implements RemoteMouseAdapter {
  public readonly moves: Array<{ readonly x: number; readonly y: number }> = [];
  public readonly downs: RemoteMouseButton[] = [];
  public readonly ups: RemoteMouseButton[] = [];
  public readonly scrolls: Array<{ readonly horizontal: number; readonly vertical: number }> = [];

  public moveTo(x: number, y: number): void {
    this.moves.push({ x, y });
  }

  public buttonDown(button: RemoteMouseButton): void {
    this.downs.push(button);
  }

  public buttonUp(button: RemoteMouseButton): void {
    this.ups.push(button);
  }

  public scroll(horizontalDelta: number, verticalDelta: number): void {
    this.scrolls.push({ horizontal: horizontalDelta, vertical: verticalDelta });
  }
}
