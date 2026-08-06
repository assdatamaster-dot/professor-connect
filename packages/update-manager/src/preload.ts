import { ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  UPDATE_IPC_CHANNELS,
  type UpdateRendererApi,
  type UpdateSettingsInput,
  type UpdateState,
} from './contracts.js';

export function createUpdateRendererApi(): UpdateRendererApi {
  return {
    getState: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.getState) as Promise<UpdateState>,
    check: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.check) as Promise<UpdateState>,
    download: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.download) as Promise<UpdateState>,
    getSettings: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.getSettings),
    saveSettings: (input: UpdateSettingsInput) =>
      ipcRenderer.invoke(UPDATE_IPC_CHANNELS.saveSettings, input),
    install: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.install) as Promise<UpdateState>,
    defer: () => ipcRenderer.invoke(UPDATE_IPC_CHANNELS.defer) as Promise<UpdateState>,
    onStateChanged(listener): () => void {
      const handler = (_event: IpcRendererEvent, state: UpdateState): void => listener(state);
      ipcRenderer.on(UPDATE_IPC_CHANNELS.stateChanged, handler);
      return () => ipcRenderer.removeListener(UPDATE_IPC_CHANNELS.stateChanged, handler);
    },
  };
}
