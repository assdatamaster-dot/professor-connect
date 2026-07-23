import { RemoteMouseController } from './remote-mouse.controller.js';
import type { RemoteMouseBoundsProvider } from './remote-mouse.types.js';
import { WindowsMouseAdapter } from './windows-mouse.adapter.js';

export function createRemoteMouseController(
  boundsProvider: RemoteMouseBoundsProvider,
): RemoteMouseController {
  if (process.platform !== 'win32') {
    throw new Error(`Controle remoto do mouse ainda não possui adaptador para ${process.platform}`);
  }
  return new RemoteMouseController(new WindowsMouseAdapter(), boundsProvider);
}
