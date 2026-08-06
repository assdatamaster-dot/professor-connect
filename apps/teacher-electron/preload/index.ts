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
  TeacherStateListener,
  TeacherWorkflowApi,
  TeacherWorkflowSnapshot,
} from '../shared/contracts.js' with { 'resolution-mode': 'import' };
import type {
  ProfessorPresenceApi,
  ProfessorPresenceSnapshot,
  AttendanceHistoryItem,
} from '../shared/presence-contracts.js' with { 'resolution-mode': 'import' };
import type {
  TeacherWebRtcApi,
  ScreenSharePayload,
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

const authApi: DesktopAuthApi = {
  login: (credentials) => ipcRenderer.invoke('teacher:auth:login', credentials),
  register: (registration) => ipcRenderer.invoke('teacher:auth:register', registration),
  logout: () => ipcRenderer.invoke('teacher:auth:logout'),
  getIdentity: () => ipcRenderer.invoke('teacher:auth:get-identity'),
  getProfile: () => ipcRenderer.invoke('teacher:auth:get-profile'),
  updateProfile: (update) => ipcRenderer.invoke('teacher:auth:update-profile', update),
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

const presenceChannels = {
  connect: 'teacher:presence:connect',
  disconnect: 'teacher:presence:disconnect',
  getState: 'teacher:presence:get-state',
  getHistory: 'teacher:presence:get-history',
  setAvailability: 'teacher:presence:set-availability',
  stateChanged: 'teacher:presence:state-changed',
  remoteControlRequest: 'teacher:remote-control:request',
  remoteControlMouse: 'teacher:remote-control:mouse',
  remoteControlKeyboard: 'teacher:remote-control:keyboard',
  remoteControlStop: 'teacher:remote-control:stop',
  resumeSession: 'teacher:presence:resume-session',
  discardRecovery: 'teacher:presence:discard-recovery',
} as const;

const presenceApi: ProfessorPresenceApi = {
  connect: (name) =>
    ipcRenderer.invoke(presenceChannels.connect, name) as Promise<ProfessorPresenceSnapshot>,
  disconnect: () =>
    ipcRenderer.invoke(presenceChannels.disconnect) as Promise<ProfessorPresenceSnapshot>,
  getState: () =>
    ipcRenderer.invoke(presenceChannels.getState) as Promise<ProfessorPresenceSnapshot>,
  getHistory: () =>
    ipcRenderer.invoke(presenceChannels.getHistory) as Promise<readonly AttendanceHistoryItem[]>,
  setAvailability: (available) =>
    ipcRenderer.invoke(
      presenceChannels.setAvailability,
      available,
    ) as Promise<ProfessorPresenceSnapshot>,
  acceptSession: (requestId) =>
    ipcRenderer.invoke(
      'teacher:presence:accept-session',
      requestId,
    ) as Promise<ProfessorPresenceSnapshot>,
  rejectSession: (requestId) =>
    ipcRenderer.invoke(
      'teacher:presence:reject-session',
      requestId,
    ) as Promise<ProfessorPresenceSnapshot>,
  endSession: () =>
    ipcRenderer.invoke('teacher:presence:end-session') as Promise<ProfessorPresenceSnapshot>,
  resumeSession: () =>
    ipcRenderer.invoke(presenceChannels.resumeSession) as Promise<ProfessorPresenceSnapshot>,
  discardRecovery: () =>
    ipcRenderer.invoke(presenceChannels.discardRecovery) as Promise<ProfessorPresenceSnapshot>,
  requestRemoteControl: () =>
    ipcRenderer.invoke(presenceChannels.remoteControlRequest) as Promise<ProfessorPresenceSnapshot>,
  sendRemoteControlMouse: (event) =>
    ipcRenderer.invoke(presenceChannels.remoteControlMouse, event) as Promise<void>,
  sendRemoteControlKeyboard: (event) =>
    ipcRenderer.invoke(presenceChannels.remoteControlKeyboard, event) as Promise<void>,
  stopRemoteControl: () =>
    ipcRenderer.invoke(presenceChannels.remoteControlStop) as Promise<ProfessorPresenceSnapshot>,
  onStateChanged(listener): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: ProfessorPresenceSnapshot): void =>
      listener(snapshot);

    ipcRenderer.on(presenceChannels.stateChanged, handler);
    return () => ipcRenderer.removeListener(presenceChannels.stateChanged, handler);
  },
};

const webRtcChannels = {
  sendOffer: 'teacher:webrtc:send-offer',
  sendAnswer: 'teacher:webrtc:send-answer',
  sendIceCandidate: 'teacher:webrtc:send-ice-candidate',
  offer: 'teacher:webrtc:offer',
  answer: 'teacher:webrtc:answer',
  iceCandidate: 'teacher:webrtc:ice-candidate',
  screenShareStarted: 'teacher:screen-share:started',
  screenShareStopped: 'teacher:screen-share:stopped',
} as const;

const webRtcApi: TeacherWebRtcApi = {
  sendOffer: (payload) => ipcRenderer.invoke(webRtcChannels.sendOffer, payload) as Promise<void>,
  sendAnswer: (payload) => ipcRenderer.invoke(webRtcChannels.sendAnswer, payload) as Promise<void>,
  sendIceCandidate: (payload) =>
    ipcRenderer.invoke(webRtcChannels.sendIceCandidate, payload) as Promise<void>,
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
  onScreenShareStarted(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: ScreenSharePayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.screenShareStarted, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.screenShareStarted, handler);
  },
  onScreenShareStopped(listener): () => void {
    const handler = (_event: IpcRendererEvent, payload: ScreenSharePayload): void =>
      listener(payload);
    ipcRenderer.on(webRtcChannels.screenShareStopped, handler);
    return () => ipcRenderer.removeListener(webRtcChannels.screenShareStopped, handler);
  },
};

const fileTransferChannels = {
  selectFiles: 'teacher:file-transfer:select-files',
  registerFiles: 'teacher:file-transfer:register-files',
  readChunk: 'teacher:file-transfer:read-chunk',
  verifySource: 'teacher:file-transfer:verify-source',
  releaseSource: 'teacher:file-transfer:release-source',
  prepareReceive: 'teacher:file-transfer:prepare-receive',
  writeChunk: 'teacher:file-transfer:write-chunk',
  completeReceive: 'teacher:file-transfer:complete-receive',
  cancelReceive: 'teacher:file-transfer:cancel-receive',
  appendAudit: 'teacher:file-transfer:append-audit',
  listHistory: 'teacher:file-transfer:list-history',
  getSettings: 'teacher:file-transfer:get-settings',
  updateSettings: 'teacher:file-transfer:update-settings',
  chooseDestination: 'teacher:file-transfer:choose-destination',
  openFile: 'teacher:file-transfer:open-file',
  openDirectory: 'teacher:file-transfer:open-directory',
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

contextBridge.exposeInMainWorld('professorConnectTeacher', workflowApi);
contextBridge.exposeInMainWorld('professorConnectPresence', presenceApi);
contextBridge.exposeInMainWorld('professorConnectWebRtc', webRtcApi);
contextBridge.exposeInMainWorld('professorConnectFileTransfer', fileTransferApi);
contextBridge.exposeInMainWorld('professorConnectAuth', authApi);
contextBridge.exposeInMainWorld('professorConnectUpdate', updateApi);
