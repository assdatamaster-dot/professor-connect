import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  TeacherStateListener,
  TeacherWorkflowApi,
  TeacherWorkflowSnapshot,
} from '../shared/contracts.js' with { 'resolution-mode': 'import' };
import type {
  ProfessorPresenceApi,
  ProfessorPresenceSnapshot,
} from '../shared/presence-contracts.js' with { 'resolution-mode': 'import' };

const channels = {
  initialize: 'teacher:workflow:initialize',
  acceptRequest: 'teacher:workflow:accept-request',
  rejectRequest: 'teacher:workflow:reject-request',
  requestScreenSharing: 'teacher:workflow:request-screen-sharing',
  requestRemoteControl: 'teacher:workflow:request-remote-control',
  endAttendance: 'teacher:workflow:end-attendance',
  stateChanged: 'teacher:workflow:state-changed',
} as const;

const workflowApi: TeacherWorkflowApi = {
  initialize: () => ipcRenderer.invoke(channels.initialize) as Promise<TeacherWorkflowSnapshot>,
  acceptRequest: (requestId) =>
    ipcRenderer.invoke(channels.acceptRequest, requestId) as Promise<TeacherWorkflowSnapshot>,
  rejectRequest: (requestId) =>
    ipcRenderer.invoke(channels.rejectRequest, requestId) as Promise<TeacherWorkflowSnapshot>,
  requestScreenSharing: () =>
    ipcRenderer.invoke(channels.requestScreenSharing) as Promise<TeacherWorkflowSnapshot>,
  requestRemoteControl: () =>
    ipcRenderer.invoke(channels.requestRemoteControl) as Promise<TeacherWorkflowSnapshot>,
  endAttendance: () =>
    ipcRenderer.invoke(channels.endAttendance) as Promise<TeacherWorkflowSnapshot>,
  onStateChanged(listener: TeacherStateListener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: TeacherWorkflowSnapshot): void => {
      listener(snapshot);
    };

    ipcRenderer.on(channels.stateChanged, handler);
    return () => ipcRenderer.removeListener(channels.stateChanged, handler);
  },
};

const presenceChannels = {
  connect: 'teacher:presence:connect',
  disconnect: 'teacher:presence:disconnect',
  getState: 'teacher:presence:get-state',
  stateChanged: 'teacher:presence:state-changed',
} as const;

const presenceApi: ProfessorPresenceApi = {
  connect: (name) =>
    ipcRenderer.invoke(presenceChannels.connect, name) as Promise<ProfessorPresenceSnapshot>,
  disconnect: () =>
    ipcRenderer.invoke(presenceChannels.disconnect) as Promise<ProfessorPresenceSnapshot>,
  getState: () =>
    ipcRenderer.invoke(presenceChannels.getState) as Promise<ProfessorPresenceSnapshot>,
  onStateChanged(listener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: ProfessorPresenceSnapshot): void =>
      listener(snapshot);

    ipcRenderer.on(presenceChannels.stateChanged, handler);
    return () => ipcRenderer.removeListener(presenceChannels.stateChanged, handler);
  },
};

contextBridge.exposeInMainWorld('professorConnectTeacher', workflowApi);
contextBridge.exposeInMainWorld('professorConnectPresence', presenceApi);
