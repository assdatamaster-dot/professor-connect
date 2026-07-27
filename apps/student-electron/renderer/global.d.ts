import type { DesktopWorkflowApi } from '../shared/contracts.js';
import type { StudentSessionApi } from '../shared/session-contracts.js';
import type { StudentWebRtcApi } from '../shared/webrtc-contracts.js';
import type { FileTransferApi } from '../shared/file-transfer-contracts.js';

declare global {
  interface Window {
    readonly professorConnect: DesktopWorkflowApi;
    readonly professorConnectSession: StudentSessionApi;
    readonly professorConnectWebRtc: StudentWebRtcApi;
    readonly professorConnectFileTransfer: FileTransferApi;
  }
}

export {};
