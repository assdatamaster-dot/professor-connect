import type { DesktopTranslations } from './i18n.js';
import type { DesktopWorkflowSnapshot } from '../shared/contracts.js';

export interface DesktopViewModel {
  readonly connectionLabel: string;
  readonly attendanceLabel: string;
  readonly remoteControlLabel: string;
  readonly screenShareLabel: string;
  readonly statusMessage: string;
  readonly isMediaVisible: boolean;
  readonly isCallButtonVisible: boolean;
  readonly isCallButtonEnabled: boolean;
  readonly isShareButtonEnabled: boolean;
  readonly isEndButtonEnabled: boolean;
}

export function createDesktopViewModel(
  snapshot: DesktopWorkflowSnapshot,
  translations: DesktopTranslations,
): DesktopViewModel {
  return {
    connectionLabel: translations.connection[snapshot.connectionStatus],
    attendanceLabel: translations.attendance[snapshot.attendanceStatus],
    remoteControlLabel: translations.remote[snapshot.remoteControlStatus],
    screenShareLabel: snapshot.isScreenSharing
      ? translations.sharingScreen
      : translations.shareScreen,
    statusMessage: snapshot.statusMessage,
    isMediaVisible: snapshot.isMediaVisible,
    isCallButtonVisible: !snapshot.isMediaVisible,
    isCallButtonEnabled: snapshot.canCallProfessor,
    isShareButtonEnabled: snapshot.canShareScreen,
    isEndButtonEnabled: snapshot.canEndAttendance,
  };
}
