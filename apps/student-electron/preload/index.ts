import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  DesktopStateListener,
  DesktopWorkflowApi,
  DesktopWorkflowSnapshot,
} from '../shared/contracts.js' with { 'resolution-mode': 'import' };

const channels = {
  initialize: 'desktop:workflow:initialize',
  callProfessor: 'desktop:workflow:call-professor',
  shareScreen: 'desktop:workflow:share-screen',
  endAttendance: 'desktop:workflow:end-attendance',
  stateChanged: 'desktop:workflow:state-changed',
} as const;

const workflowApi: DesktopWorkflowApi = {
  initialize: () => ipcRenderer.invoke(channels.initialize) as Promise<DesktopWorkflowSnapshot>,
  callProfessor: () =>
    ipcRenderer.invoke(channels.callProfessor) as Promise<DesktopWorkflowSnapshot>,
  shareScreen: () => ipcRenderer.invoke(channels.shareScreen) as Promise<DesktopWorkflowSnapshot>,
  endAttendance: () =>
    ipcRenderer.invoke(channels.endAttendance) as Promise<DesktopWorkflowSnapshot>,
  onStateChanged(listener: DesktopStateListener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: DesktopWorkflowSnapshot): void => {
      listener(snapshot);
    };

    ipcRenderer.on(channels.stateChanged, handler);
    return () => ipcRenderer.removeListener(channels.stateChanged, handler);
  },
};

contextBridge.exposeInMainWorld('professorConnect', workflowApi);
