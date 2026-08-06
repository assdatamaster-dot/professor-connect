import type { AppUpdaterLike } from './contracts.js';

export class InstallManager {
  public constructor(private readonly updater: AppUpdaterLike) {}

  public configureInstallOnQuit(enabled: boolean, attendanceActive: boolean): void {
    this.updater.autoInstallOnAppQuit = enabled && !attendanceActive;
  }

  public install(attendanceActive: boolean): boolean {
    if (attendanceActive) return false;
    this.updater.quitAndInstall(true, true);
    return true;
  }
}
