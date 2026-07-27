import type { TeacherWorkflowApi } from '../shared/contracts.js';
import type { ProfessorPresenceApi } from '../shared/presence-contracts.js';
import type { TeacherWebRtcApi } from '../shared/webrtc-contracts.js';
import type { FileTransferApi } from '../shared/file-transfer-contracts.js';

declare global {
  interface Window {
    readonly professorConnectTeacher: TeacherWorkflowApi;
    readonly professorConnectPresence: ProfessorPresenceApi;
    readonly professorConnectWebRtc: TeacherWebRtcApi;
    readonly professorConnectFileTransfer: FileTransferApi;
  }
}

export {};
