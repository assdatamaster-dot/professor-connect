import type { TeacherWorkflowApi } from '../shared/contracts.js';

declare global {
  interface Window {
    readonly professorConnectTeacher: TeacherWorkflowApi;
  }
}

export {};
