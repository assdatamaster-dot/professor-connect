import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { TeacherWorkflowSnapshot } from '../shared/contracts.js';
import { TEACHER_IPC_CHANNELS } from '../shared/ipc-channels.js';
import type { TeacherWorkflowController } from './teacher-workflow.controller.js';

export interface TeacherIpcRegistration {
  dispose(): void;
}

export function registerTeacherIpc(
  controller: TeacherWorkflowController,
  renderer: WebContents,
): TeacherIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };
  const handle = (
    channel: string,
    action: (requestId?: string) => Promise<TeacherWorkflowSnapshot> | TeacherWorkflowSnapshot,
  ): void => {
    ipcMain.handle(channel, async (event, requestId: unknown) => {
      assertSender(event);
      if (
        requestId !== undefined &&
        (typeof requestId !== 'string' || requestId.trim().length === 0)
      ) {
        throw new Error('Identificador de solicitação inválido');
      }
      return action(requestId);
    });
  };

  handle(TEACHER_IPC_CHANNELS.INITIALIZE, () => controller.initialize());
  handle(TEACHER_IPC_CHANNELS.ACCEPT_REQUEST, (requestId) =>
    controller.acceptRequest(requireRequestId(requestId)),
  );
  handle(TEACHER_IPC_CHANNELS.REJECT_REQUEST, (requestId) =>
    controller.rejectRequest(requireRequestId(requestId)),
  );
  handle(TEACHER_IPC_CHANNELS.REQUEST_SCREEN_SHARING, () => controller.requestScreenSharing());
  handle(TEACHER_IPC_CHANNELS.REQUEST_REMOTE_CONTROL, () => controller.requestRemoteControl());
  handle(TEACHER_IPC_CHANNELS.END_ATTENDANCE, () => controller.endAttendance());

  const unsubscribe = controller.onStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(TEACHER_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      for (const channel of Object.values(TEACHER_IPC_CHANNELS)) {
        if (channel !== TEACHER_IPC_CHANNELS.STATE_CHANGED) {
          ipcMain.removeHandler(channel);
        }
      }
    },
  };
}

function requireRequestId(requestId: string | undefined): string {
  if (requestId === undefined) {
    throw new Error('Identificador de solicitação obrigatório');
  }
  return requestId;
}
