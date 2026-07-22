import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  DesktopStateListener,
  DesktopWorkflowApi,
  DesktopWorkflowSnapshot,
} from '../shared/contracts.js' with { 'resolution-mode': 'import' };
import type {
  StudentSessionApi,
  StudentSessionListener,
  StudentSessionSnapshot,
} from '../shared/session-contracts.js' with { 'resolution-mode': 'import' };
import type {
  StudentWebRtcApi,
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js' with { 'resolution-mode': 'import' };

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

const sessionChannels = {
  getTeachers: 'student:session:get-teachers',
  request: 'student:session:request',
  getState: 'student:session:get-state',
  end: 'student:session:end',
  stateChanged: 'student:session:state-changed',
} as const;

const sessionApi: StudentSessionApi = {
  getOnlineTeachers: () => ipcRenderer.invoke(sessionChannels.getTeachers),
  requestSession: (teacherId) =>
    ipcRenderer.invoke(sessionChannels.request, teacherId) as Promise<StudentSessionSnapshot>,
  getState: () => ipcRenderer.invoke(sessionChannels.getState) as Promise<StudentSessionSnapshot>,
  endSession: () => ipcRenderer.invoke(sessionChannels.end) as Promise<StudentSessionSnapshot>,
  onStateChanged(listener: StudentSessionListener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: StudentSessionSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(sessionChannels.stateChanged, handler);
    return () => ipcRenderer.removeListener(sessionChannels.stateChanged, handler);
  },
};

const webRtcChannels = {
  sendAnswer: 'student:webrtc:send-answer',
  sendIceCandidate: 'student:webrtc:send-ice-candidate',
  offer: 'student:webrtc:offer',
  iceCandidate: 'student:webrtc:ice-candidate',
} as const;

const webRtcApi: StudentWebRtcApi = {
  sendAnswer: (payload) => ipcRenderer.invoke(webRtcChannels.sendAnswer, payload) as Promise<void>,
  sendIceCandidate: (payload) =>
    ipcRenderer.invoke(webRtcChannels.sendIceCandidate, payload) as Promise<void>,
  onOffer(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: WebRtcDescriptionPayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.offer, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.offer, handler);
  },
  onIceCandidate(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: WebRtcIceCandidatePayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.iceCandidate, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.iceCandidate, handler);
  },
};

contextBridge.exposeInMainWorld('professorConnect', workflowApi);
contextBridge.exposeInMainWorld('professorConnectSession', sessionApi);
contextBridge.exposeInMainWorld('professorConnectWebRtc', webRtcApi);
