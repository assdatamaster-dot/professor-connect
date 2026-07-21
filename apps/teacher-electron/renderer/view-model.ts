import type { TeacherWorkflowSnapshot } from '../shared/contracts.js';
import type { TeacherTranslations } from './i18n.js';

export interface TeacherViewModel {
  readonly connectionLabel: string;
  readonly attendanceLabel: string;
  readonly statusMessage: string;
  readonly screenSharingLabel: string;
  readonly remoteControlLabel: string;
  readonly isMediaVisible: boolean;
  readonly isDashboardVisible: boolean;
  readonly canAcceptRequests: boolean;
  readonly canRequestScreenSharing: boolean;
  readonly canRequestRemoteControl: boolean;
  readonly canEndAttendance: boolean;
}

export function createTeacherViewModel(
  snapshot: TeacherWorkflowSnapshot,
  translations: TeacherTranslations,
): TeacherViewModel {
  return {
    connectionLabel: translations.connection[snapshot.connectionStatus],
    attendanceLabel: translations.attendance[snapshot.attendanceStatus],
    statusMessage: snapshot.statusMessage,
    screenSharingLabel: translations.actionStatus[snapshot.screenSharingStatus],
    remoteControlLabel: translations.actionStatus[snapshot.remoteControlStatus],
    isMediaVisible: snapshot.isMediaVisible,
    isDashboardVisible: !snapshot.isMediaVisible,
    canAcceptRequests: snapshot.canAcceptRequests,
    canRequestScreenSharing: snapshot.canRequestScreenSharing,
    canRequestRemoteControl: snapshot.canRequestRemoteControl,
    canEndAttendance: snapshot.canEndAttendance,
  };
}
