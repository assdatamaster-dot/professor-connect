import { RemoteKeyboardController } from '../remote-keyboard/remote-keyboard.controller.js';
import { WindowsKeyboardAdapter } from '../remote-keyboard/windows-keyboard.adapter.js';
import { createRemoteMouseController } from '../remote-mouse/create-remote-mouse-controller.js';
import type { RemoteMouseBoundsProvider } from '../remote-mouse/remote-mouse.types.js';
import { RemoteInputController } from './remote-input.controller.js';

export function createRemoteInputController(
  boundsProvider: RemoteMouseBoundsProvider,
): RemoteInputController {
  if (process.platform !== 'win32') {
    throw new Error(
      `Controle remoto de entrada ainda não possui adaptador para ${process.platform}`,
    );
  }
  return new RemoteInputController(
    createRemoteMouseController(boundsProvider),
    new RemoteKeyboardController(new WindowsKeyboardAdapter()),
  );
}
