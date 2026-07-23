import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RemoteControlClient } from '../renderer/remote-control.client.js';
import type { RemoteControlMouseEvent } from '../shared/remote-control-contracts.js';

test('normaliza a área visível do vídeo e envia somente eventos de mouse', async () => {
  const pointerTarget = new VideoTarget();
  const mouseEvents: RemoteControlMouseEvent[] = [];
  const windowTarget = new EventTarget();
  const documentTarget = new VisibilityTarget();
  let safetyStops = 0;
  let animationCallback: FrameRequestCallback | undefined;
  const originals = installBrowserGlobals(windowTarget, documentTarget, (callback) => {
    animationCallback = callback;
    return 1;
  });

  try {
    const client = new RemoteControlClient(
      pointerTarget as unknown as HTMLVideoElement,
      {
        sendMouse(event): Promise<void> {
          mouseEvents.push(event);
          return Promise.resolve();
        },
      },
      () => undefined,
      async () => {
        safetyStops += 1;
      },
    );

    client.start();
    pointerTarget.dispatchEvent(createPointerEvent('mousemove', { clientX: 110, clientY: 120 }));
    animationCallback?.(0);
    pointerTarget.dispatchEvent(
      createPointerEvent('mousedown', {
        clientX: 110,
        clientY: 120,
        button: 0,
        buttons: 1,
      }),
    );
    pointerTarget.dispatchEvent(
      createPointerEvent('mouseup', { clientX: 110, clientY: 120, button: 0, buttons: 0 }),
    );
    pointerTarget.dispatchEvent(
      createPointerEvent('dblclick', {
        clientX: 110,
        clientY: 120,
        button: 0,
        buttons: 0,
      }),
    );
    pointerTarget.dispatchEvent(
      createPointerEvent('wheel', {
        clientX: 110,
        clientY: 120,
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
      }),
    );

    assert.deepEqual(
      mouseEvents.map(({ type }) => type),
      ['mousemove', 'mousedown', 'mouseup', 'dblclick', 'wheel'],
    );
    assert.equal(mouseEvents[0]?.x, 0.5);
    assert.equal(mouseEvents[0]?.y, 0.5);
    assert.equal(mouseEvents[4]?.deltaY, 120);

    pointerTarget.dispatchEvent(createPointerEvent('mousemove', { clientX: 110, clientY: 30 }));
    animationCallback?.(0);
    assert.equal(mouseEvents.length, 5, 'ignora letterbox fora da imagem compartilhada');

    windowTarget.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    assert.equal(safetyStops, 1);
    assert.equal(client.isActive(), false);
  } finally {
    restoreBrowserGlobals(originals);
  }
});

class VideoTarget extends EventTarget {
  public readonly videoWidth = 1920;
  public readonly videoHeight = 1080;

  public getBoundingClientRect(): DOMRect {
    return {
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 220,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    };
  }
}

class VisibilityTarget extends EventTarget {
  public visibilityState: DocumentVisibilityState = 'visible';
}

function createPointerEvent(type: string, properties: Partial<MouseEvent & WheelEvent>): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: 10,
    clientY: 20,
    button: 0,
    buttons: 0,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...properties,
  });
}

interface BrowserGlobals {
  readonly window: unknown;
  readonly document: unknown;
  readonly getComputedStyle: unknown;
  readonly requestAnimationFrame: unknown;
  readonly cancelAnimationFrame: unknown;
}

function installBrowserGlobals(
  windowTarget: EventTarget,
  documentTarget: VisibilityTarget,
  requestFrame: (callback: FrameRequestCallback) => number,
): BrowserGlobals {
  const originals: BrowserGlobals = {
    window: Reflect.get(globalThis, 'window'),
    document: Reflect.get(globalThis, 'document'),
    getComputedStyle: Reflect.get(globalThis, 'getComputedStyle'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: windowTarget },
    document: { configurable: true, value: documentTarget },
    getComputedStyle: { configurable: true, value: () => ({ objectFit: 'contain' }) },
    requestAnimationFrame: { configurable: true, value: requestFrame },
    cancelAnimationFrame: { configurable: true, value: () => undefined },
  });
  return originals;
}

function restoreBrowserGlobals(originals: BrowserGlobals): void {
  for (const [name, value] of Object.entries(originals)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  }
}
