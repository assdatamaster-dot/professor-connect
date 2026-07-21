import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import { DESKTOP_IPC_CHANNELS } from '../shared/ipc-channels.js';
import type { DesktopWorkflowSnapshot } from '../shared/contracts.js';
import type { StudentWorkflowController } from './student-workflow.controller.js';

export interface DesktopIpcRegistration {
  dispose(): void;
}

export function registerDesktopIpc(
  controller: StudentWorkflowController,
  renderer: WebContents,
): DesktopIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };
  const handle = (
    channel: string,
    action: () => Promise<DesktopWorkflowSnapshot> | DesktopWorkflowSnapshot,
  ): void => {
    ipcMain.handle(channel, async (event) => {
      assertSender(event);
      return action();
    });
  };

  handle(DESKTOP_IPC_CHANNELS.INITIALIZE, () => controller.initialize());
  handle(DESKTOP_IPC_CHANNELS.CALL_PROFESSOR, () => controller.callProfessor());
  handle(DESKTOP_IPC_CHANNELS.SHARE_SCREEN, () => controller.shareScreen());
  handle(DESKTOP_IPC_CHANNELS.END_ATTENDANCE, () => controller.endAttendance());

  const unsubscribe = controller.onStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(DESKTOP_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.INITIALIZE);
      ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.CALL_PROFESSOR);
      ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.SHARE_SCREEN);
      ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.END_ATTENDANCE);
    },
  };
}
