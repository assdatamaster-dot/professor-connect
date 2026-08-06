import type { AppUpdaterLike, UpdateChannel } from './contracts.js';
import type { VersionService } from './version-service.js';

export class UpdateChecker {
  private checking: Promise<void> | undefined;

  public constructor(
    private readonly updater: AppUpdaterLike,
    private readonly versions: VersionService,
  ) {}

  public configure(channel: UpdateChannel): void {
    this.updater.channel = this.versions.updaterChannel(channel);
    this.updater.allowPrerelease = this.versions.allowsPrerelease(channel);
  }

  public check(): Promise<void> {
    if (this.checking !== undefined) return this.checking;
    this.checking = this.updater
      .checkForUpdates()
      .then(() => undefined)
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }
}
