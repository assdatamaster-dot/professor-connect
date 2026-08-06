import type { AppUpdaterLike } from './contracts.js';

export class DownloadManager {
  private downloading: Promise<void> | undefined;

  public constructor(private readonly updater: AppUpdaterLike) {}

  public download(): Promise<void> {
    if (this.downloading !== undefined) return this.downloading;
    this.downloading = this.updater
      .downloadUpdate()
      .then(() => undefined)
      .finally(() => {
        this.downloading = undefined;
      });
    return this.downloading;
  }
}
