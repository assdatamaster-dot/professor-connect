import type { TeacherWorkflowApi } from '../shared/contracts.js';
import type { ProfessorPresenceApi } from '../shared/presence-contracts.js';

declare global {
  interface Window {
    readonly professorConnectTeacher: TeacherWorkflowApi;
    readonly professorConnectPresence: ProfessorPresenceApi;
  }
}

export {};
