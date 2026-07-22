import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { StudentSessionSnapshot } from '../shared/session-contracts.js';
import { SESSION_IPC_CHANNELS } from '../shared/session-ipc-channels.js';
import type { StudentPresenceController } from './student-presence.controller.js';

export interface SessionIpcRegistration {
  dispose(): void;
}

export function registerSessionIpc(
  controller: StudentPresenceController,
  renderer: WebContents,
): SessionIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };

  ipcMain.handle(SESSION_IPC_CHANNELS.GET_TEACHERS, (event) => {
    assertSender(event);
    return controller.getOnlineTeachers();
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.REQUEST, (event, teacherId: unknown) => {
    assertSender(event);
    if (typeof teacherId !== 'string') {
      throw new Error('Professor inválido');
    }
    return controller.requestSession(teacherId);
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.GET_STATE, (event): StudentSessionSnapshot => {
    assertSender(event);
    return controller.getSessionSnapshot();
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.END, (event): StudentSessionSnapshot => {
    assertSender(event);
    return controller.endSession();
  });

  const unsubscribe = controller.onSessionStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(SESSION_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.GET_TEACHERS);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.REQUEST);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.GET_STATE);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.END);
    },
  };
}
