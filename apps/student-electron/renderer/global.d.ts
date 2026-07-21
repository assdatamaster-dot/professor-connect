import type { DesktopWorkflowApi } from '../shared/contracts.js';

declare global {
  interface Window {
    readonly professorConnect: DesktopWorkflowApi;
  }
}

export {};
