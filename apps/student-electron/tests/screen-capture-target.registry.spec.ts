import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesktopCapturerSource, Display, Screen } from 'electron';

import { ScreenCaptureTargetRegistry } from '../main/screen-capture-target.registry.js';

test('cria o layout e os limites do desktop virtual com todos os monitores', () => {
  const displays = [
    createDisplay(10, 'Monitor esquerdo', -1280, 0, 1280, 1024),
    createDisplay(20, 'Monitor principal', 0, 0, 1920, 1080),
  ];
  const registry = new ScreenCaptureTargetRegistry(createScreen(displays));

  const layout = registry.selectAll([
    createSource('screen:20:0', 'Monitor principal', '20'),
    createSource('screen:10:0', 'Monitor esquerdo', '10'),
  ]);

  assert.deepEqual(layout, {
    width: 3200,
    height: 1080,
    displays: [
      {
        displayId: '10',
        name: 'Monitor esquerdo',
        x: 0,
        y: 0,
        width: 1280,
        height: 1024,
      },
      {
        displayId: '20',
        name: 'Monitor principal',
        x: 1280,
        y: 0,
        width: 1920,
        height: 1080,
      },
    ],
  });
  assert.deepEqual(registry.getBounds(), {
    left: -1280,
    top: 0,
    width: 3200,
    height: 1080,
    sourceName: '2 monitor(es)',
    regions: [
      { left: -1280, top: 0, width: 1280, height: 1024 },
      { left: 0, top: 0, width: 1920, height: 1080 },
    ],
  });
});

test('recusa controle depois que a captura é limpa', () => {
  const displays = [createDisplay(1, 'Monitor', 0, 0, 1920, 1080)];
  const registry = new ScreenCaptureTargetRegistry(createScreen(displays));
  registry.selectAll([createSource('screen:1:0', 'Monitor', '1')]);

  registry.clear();

  assert.throws(() => registry.getBounds(), /Compartilhe todos os monitores/);
});

function createScreen(displays: readonly Display[]): Screen {
  return {
    getAllDisplays: () => displays,
    dipToScreenPoint: (point: { readonly x: number; readonly y: number }) => ({ ...point }),
  } as unknown as Screen;
}

function createDisplay(
  id: number,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Display {
  return {
    id,
    label,
    bounds: { x, y, width, height },
    scaleFactor: 1,
  } as unknown as Display;
}

function createSource(id: string, name: string, displayId: string): DesktopCapturerSource {
  return { id, name, display_id: displayId } as DesktopCapturerSource;
}
