import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { DesktopAuthApi } from '@professor-connect/shared' with {
  'resolution-mode': 'import',
};
import type {
  UpdateRendererApi,
  UpdateSettingsInput,
  UpdateState,
} from '@professor-connect/update-manager' with { 'resolution-mode': 'import' };

import type {
  DesktopStateListener,
  DesktopWorkflowApi,
  DesktopWorkflowSnapshot,
} from '../shared/contracts.js' with { 'resolution-mode': 'import' };
import type {
  StudentSessionApi,
  AvailableTeachersListener,
  AttendanceHistoryItem,
  OnlineTeacher,
  StudentSessionListener,
  StudentSessionSnapshot,
} from '../shared/session-contracts.js' with { 'resolution-mode': 'import' };
import type {
  StudentWebRtcApi,
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js' with { 'resolution-mode': 'import' };
import type {
  FileTransferApi,
  FileTransferAuditPayload,
  FileTransferChunkPayload,
  FileTransferMetadata,
  FileTransferSettings,
  FileTransferVerification,
  PreparedIncomingFile,
} from '../shared/file-transfer-contracts.js' with { 'resolution-mode': 'import' };

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

const updateApi: UpdateRendererApi = {
  getState: () => ipcRenderer.invoke('update-manager:get-state') as Promise<UpdateState>,
  check: () => ipcRenderer.invoke('update-manager:check') as Promise<UpdateState>,
  download: () => ipcRenderer.invoke('update-manager:download') as Promise<UpdateState>,
  getSettings: () => ipcRenderer.invoke('update-manager:get-settings'),
  saveSettings: (input: UpdateSettingsInput) =>
    ipcRenderer.invoke('update-manager:save-settings', input),
  install: () => ipcRenderer.invoke('update-manager:install') as Promise<UpdateState>,
  defer: () => ipcRenderer.invoke('update-manager:defer') as Promise<UpdateState>,
  onStateChanged(listener): () => void {
    const handler = (_event: IpcRendererEvent, state: UpdateState): void => listener(state);
    ipcRenderer.on('update-manager:state-changed', handler);
    return () => ipcRenderer.removeListener('update-manager:state-changed', handler);
  },
};

const sessionChannels = {
  getTeachers: 'student:session:get-teachers',
  getHistory: 'student:session:get-history',
  request: 'student:session:request',
  cancelRequest: 'student:session:cancel-request',
  getState: 'student:session:get-state',
  end: 'student:session:end',
  resume: 'student:session:resume',
  discardRecovery: 'student:session:discard-recovery',
  stateChanged: 'student:session:state-changed',
  teachersChanged: 'student:session:teachers-changed',
  remoteControlApprove: 'student:remote-control:approve',
  remoteControlDeny: 'student:remote-control:deny',
  remoteControlStop: 'student:remote-control:stop',
} as const;

const sessionApi: StudentSessionApi = {
  getOnlineTeachers: () => ipcRenderer.invoke(sessionChannels.getTeachers),
  getHistory: () =>
    ipcRenderer.invoke(sessionChannels.getHistory) as Promise<readonly AttendanceHistoryItem[]>,
  requestSession: (teacherId) =>
    ipcRenderer.invoke(sessionChannels.request, teacherId) as Promise<StudentSessionSnapshot>,
  cancelRequest: () =>
    ipcRenderer.invoke(sessionChannels.cancelRequest) as Promise<StudentSessionSnapshot>,
  getState: () => ipcRenderer.invoke(sessionChannels.getState) as Promise<StudentSessionSnapshot>,
  endSession: () => ipcRenderer.invoke(sessionChannels.end) as Promise<StudentSessionSnapshot>,
  resumeSession: () =>
    ipcRenderer.invoke(sessionChannels.resume) as Promise<StudentSessionSnapshot>,
  discardRecovery: () =>
    ipcRenderer.invoke(sessionChannels.discardRecovery) as Promise<StudentSessionSnapshot>,
  approveRemoteControl: () =>
    ipcRenderer.invoke(sessionChannels.remoteControlApprove) as Promise<StudentSessionSnapshot>,
  denyRemoteControl: () =>
    ipcRenderer.invoke(sessionChannels.remoteControlDeny) as Promise<StudentSessionSnapshot>,
  stopRemoteControl: () =>
    ipcRenderer.invoke(sessionChannels.remoteControlStop) as Promise<StudentSessionSnapshot>,
  onStateChanged(listener: StudentSessionListener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: StudentSessionSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(sessionChannels.stateChanged, handler);
    return () => ipcRenderer.removeListener(sessionChannels.stateChanged, handler);
  },
  onAvailableTeachersChanged(listener: AvailableTeachersListener): () => void {
    const handler = (_event: IpcRendererEvent, teachers: readonly OnlineTeacher[]): void => {
      listener(teachers);
    };
    ipcRenderer.on(sessionChannels.teachersChanged, handler);
    return () => ipcRenderer.removeListener(sessionChannels.teachersChanged, handler);
  },
};

const webRtcChannels = {
  sendOffer: 'student:webrtc:send-offer',
  sendAnswer: 'student:webrtc:send-answer',
  sendIceCandidate: 'student:webrtc:send-ice-candidate',
  sendScreenShareStart: 'student:screen-share:start',
  sendScreenShareStop: 'student:screen-share:stop',
  prepareAllScreensCapture: 'student:screen-capture:prepare-all',
  offer: 'student:webrtc:offer',
  answer: 'student:webrtc:answer',
  iceCandidate: 'student:webrtc:ice-candidate',
} as const;

const webRtcApi: StudentWebRtcApi = {
  prepareAllScreensCapture: () => ipcRenderer.invoke(webRtcChannels.prepareAllScreensCapture),
  sendOffer: (payload) => ipcRenderer.invoke(webRtcChannels.sendOffer, payload) as Promise<void>,
  sendAnswer: (payload) => ipcRenderer.invoke(webRtcChannels.sendAnswer, payload) as Promise<void>,
  sendIceCandidate: (payload) =>
    ipcRenderer.invoke(webRtcChannels.sendIceCandidate, payload) as Promise<void>,
  sendScreenShareStart: (payload) =>
    ipcRenderer.invoke(webRtcChannels.sendScreenShareStart, payload) as Promise<void>,
  sendScreenShareStop: (payload) =>
    ipcRenderer.invoke(webRtcChannels.sendScreenShareStop, payload) as Promise<void>,
  onOffer(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: WebRtcDescriptionPayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.offer, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.offer, handler);
  },
  onAnswer(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: WebRtcDescriptionPayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.answer, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.answer, handler);
  },
  onIceCandidate(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: WebRtcIceCandidatePayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.iceCandidate, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.iceCandidate, handler);
  },
};

const fileTransferChannels = {
  selectFiles: 'student:file-transfer:select-files',
  registerFiles: 'student:file-transfer:register-files',
  readChunk: 'student:file-transfer:read-chunk',
  verifySource: 'student:file-transfer:verify-source',
  releaseSource: 'student:file-transfer:release-source',
  prepareReceive: 'student:file-transfer:prepare-receive',
  writeChunk: 'student:file-transfer:write-chunk',
  completeReceive: 'student:file-transfer:complete-receive',
  cancelReceive: 'student:file-transfer:cancel-receive',
  appendAudit: 'student:file-transfer:append-audit',
  listHistory: 'student:file-transfer:list-history',
  getSettings: 'student:file-transfer:get-settings',
  updateSettings: 'student:file-transfer:update-settings',
  chooseDestination: 'student:file-transfer:choose-destination',
  openFile: 'student:file-transfer:open-file',
  openDirectory: 'student:file-transfer:open-directory',
} as const;

const fileTransferApi: FileTransferApi = {
  selectFiles: () =>
    ipcRenderer.invoke(fileTransferChannels.selectFiles) as Promise<
      readonly FileTransferMetadata[]
    >,
  selectDroppedFiles: (files) =>
    ipcRenderer.invoke(
      fileTransferChannels.registerFiles,
      files.map((file) => webUtils.getPathForFile(file)),
    ) as Promise<readonly FileTransferMetadata[]>,
  readChunk: (transferId, index) =>
    ipcRenderer.invoke(
      fileTransferChannels.readChunk,
      transferId,
      index,
    ) as Promise<FileTransferChunkPayload>,
  verifySource: (transferId) =>
    ipcRenderer.invoke(fileTransferChannels.verifySource, transferId) as Promise<boolean>,
  releaseSource: (transferId) =>
    ipcRenderer.invoke(fileTransferChannels.releaseSource, transferId) as Promise<void>,
  prepareReceive: (metadata) =>
    ipcRenderer.invoke(
      fileTransferChannels.prepareReceive,
      metadata,
    ) as Promise<PreparedIncomingFile>,
  writeChunk: (payload) =>
    ipcRenderer.invoke(fileTransferChannels.writeChunk, payload) as Promise<number>,
  completeReceive: (transferId) =>
    ipcRenderer.invoke(
      fileTransferChannels.completeReceive,
      transferId,
    ) as Promise<FileTransferVerification>,
  cancelReceive: (transferId) =>
    ipcRenderer.invoke(fileTransferChannels.cancelReceive, transferId) as Promise<void>,
  appendAudit: (payload: FileTransferAuditPayload) =>
    ipcRenderer.invoke(fileTransferChannels.appendAudit, payload) as Promise<void>,
  listHistory: () =>
    ipcRenderer.invoke(fileTransferChannels.listHistory) as Promise<
      readonly FileTransferAuditPayload[]
    >,
  getSettings: () =>
    ipcRenderer.invoke(fileTransferChannels.getSettings) as Promise<FileTransferSettings>,
  updateSettings: (update) =>
    ipcRenderer.invoke(
      fileTransferChannels.updateSettings,
      update,
    ) as Promise<FileTransferSettings>,
  chooseDestinationDirectory: () =>
    ipcRenderer.invoke(fileTransferChannels.chooseDestination) as Promise<
      FileTransferSettings | undefined
    >,
  openFile: (filePath) =>
    ipcRenderer.invoke(fileTransferChannels.openFile, filePath) as Promise<void>,
  openDirectory: () => ipcRenderer.invoke(fileTransferChannels.openDirectory) as Promise<void>,
};

contextBridge.exposeInMainWorld('professorConnect', workflowApi);
contextBridge.exposeInMainWorld('professorConnectSession', sessionApi);
contextBridge.exposeInMainWorld('professorConnectWebRtc', webRtcApi);
contextBridge.exposeInMainWorld('professorConnectFileTransfer', fileTransferApi);
contextBridge.exposeInMainWorld('professorConnectAuth', {
  login: (credentials) => ipcRenderer.invoke('student:auth:login', credentials),
  register: (registration) => ipcRenderer.invoke('student:auth:register', registration),
  logout: () => ipcRenderer.invoke('student:auth:logout'),
  getIdentity: () => ipcRenderer.invoke('student:auth:get-identity'),
  getProfile: () => ipcRenderer.invoke('student:auth:get-profile'),
  updateProfile: (update) => ipcRenderer.invoke('student:auth:update-profile', update),
} satisfies DesktopAuthApi);
contextBridge.exposeInMainWorld('professorConnectUpdate', updateApi);
