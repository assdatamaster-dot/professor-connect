import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import {
  UPDATE_IPC_CHANNELS,
  type UpdateRendererApi,
  type UpdateSettingsInput,
} from './contracts.js';
import type { UpdateManager } from './update-manager.js';

export class UpdateUIController {
  public constructor(
    private readonly manager: UpdateManager,
    private readonly webContents: () => WebContents | undefined,
  ) {}

  public register(): void {
    ipcMain.handle(UPDATE_IPC_CHANNELS.getState, (event) => {
      this.requireTrustedSender(event);
      return this.manager.getState();
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.check, async (event) => {
      this.requireTrustedSender(event);
      return this.manager.check();
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.download, async (event) => {
      this.requireTrustedSender(event);
      return this.manager.download();
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.getSettings, async (event) => {
      this.requireTrustedSender(event);
      return this.manager.getSettings();
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.saveSettings, async (event, input: UpdateSettingsInput) => {
      this.requireTrustedSender(event);
      return this.manager.saveSettings(input);
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.install, async (event) => {
      this.requireTrustedSender(event);
      return this.manager.install();
    });
    ipcMain.handle(UPDATE_IPC_CHANNELS.defer, (event) => {
      this.requireTrustedSender(event);
      return this.manager.defer();
    });
  }

  public dispose(): void {
    for (const channel of [
      UPDATE_IPC_CHANNELS.getState,
      UPDATE_IPC_CHANNELS.check,
      UPDATE_IPC_CHANNELS.download,
      UPDATE_IPC_CHANNELS.getSettings,
      UPDATE_IPC_CHANNELS.saveSettings,
      UPDATE_IPC_CHANNELS.install,
      UPDATE_IPC_CHANNELS.defer,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }

  private requireTrustedSender(event: IpcMainInvokeEvent): void {
    if (event.sender.id !== this.webContents()?.id) throw new Error('Origem IPC não autorizada');
  }
}

export type UpdateManagerRendererApi = UpdateRendererApi;
