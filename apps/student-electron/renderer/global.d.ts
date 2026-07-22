import type { DesktopWorkflowApi } from '../shared/contracts.js';
import type { StudentSessionApi } from '../shared/session-contracts.js';

declare global {
  interface Window {
    readonly professorConnect: DesktopWorkflowApi;
    readonly professorConnectSession: StudentSessionApi;
  }
}

export {};
