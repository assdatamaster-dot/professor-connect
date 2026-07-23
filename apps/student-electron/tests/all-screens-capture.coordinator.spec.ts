import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesktopCapturerSource, Display, Screen } from 'electron';

import { AllScreensCaptureCoordinator } from '../main/all-screens-capture.coordinator.js';
import { ScreenCaptureTargetRegistry } from '../main/screen-capture-target.registry.js';

test('enfileira uma fonte por monitor na mesma ordem do vídeo composto', async () => {
  const sources = [
    createSource('screen:2:0', 'Direito', '2'),
    createSource('screen:1:0', 'Esquerdo', '1'),
  ];
  const registry = new ScreenCaptureTargetRegistry({
    getAllDisplays: () => [createDisplay(2, 'Direito', 1920), createDisplay(1, 'Esquerdo', 0)],
    dipToScreenPoint: (point: { readonly x: number; readonly y: number }) => ({ ...point }),
  } as unknown as Screen);
  const coordinator = new AllScreensCaptureCoordinator(async () => sources, registry);

  const layout = await coordinator.prepare();

  assert.deepEqual(
    layout.displays.map((display) => display.displayId),
    ['1', '2'],
  );
  assert.equal(coordinator.takeNextSource()?.display_id, '1');
  assert.equal(coordinator.takeNextSource()?.display_id, '2');
  assert.equal(coordinator.hasPendingSource(), false);
});

test('limpa a fila e invalida os limites de controle', async () => {
  const source = createSource('screen:1:0', 'Monitor', '1');
  const registry = new ScreenCaptureTargetRegistry({
    getAllDisplays: () => [createDisplay(1, 'Monitor', 0)],
    dipToScreenPoint: (point: { readonly x: number; readonly y: number }) => ({ ...point }),
  } as unknown as Screen);
  const coordinator = new AllScreensCaptureCoordinator(async () => [source], registry);
  await coordinator.prepare();

  coordinator.clear();

  assert.equal(coordinator.hasPendingSource(), false);
  assert.throws(() => registry.getBounds(), /Compartilhe todos os monitores/);
});

function createDisplay(id: number, label: string, x: number): Display {
  return {
    id,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  } as unknown as Display;
}

function createSource(id: string, name: string, displayId: string): DesktopCapturerSource {
  return { id, name, display_id: displayId } as DesktopCapturerSource;
}
