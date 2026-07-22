import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { ProfessorPresenceSnapshot } from '../shared/presence-contracts.js';
import { PRESENCE_IPC_CHANNELS } from '../shared/presence-ipc-channels.js';
import type { ProfessorPresenceController } from './professor-presence.controller.js';

export interface PresenceIpcRegistration {
  dispose(): void;
}

export function registerPresenceIpc(
  controller: ProfessorPresenceController,
  renderer: WebContents,
): PresenceIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };

  ipcMain.handle(PRESENCE_IPC_CHANNELS.CONNECT, async (event, name: unknown) => {
    assertSender(event);
    if (typeof name !== 'string') {
      throw new Error('Nome do professor inválido');
    }
    return controller.connect(name);
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.DISCONNECT, (event): ProfessorPresenceSnapshot => {
    assertSender(event);
    return controller.disconnect();
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.GET_STATE, (event): ProfessorPresenceSnapshot => {
    assertSender(event);
    return controller.getSnapshot();
  });

  const unsubscribe = controller.onStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.CONNECT);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.DISCONNECT);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.GET_STATE);
    },
  };
}
