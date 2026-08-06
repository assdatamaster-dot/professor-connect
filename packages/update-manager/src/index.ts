import electronUpdater from 'electron-updater';

import type { AppUpdaterLike } from './contracts.js';

export * from './contracts.js';
export { DownloadManager } from './download-manager.js';
export { InstallManager } from './install-manager.js';
export { ReleaseNotesService } from './release-notes-service.js';
export { RollbackManager } from './rollback-manager.js';
export { UpdateChecker } from './update-checker.js';
export { UpdateFileLogger } from './update-file-logger.js';
export { UpdateManager, type UpdateManagerOptions } from './update-manager.js';
export { UpdateSettingsStore, DEFAULT_UPDATE_SETTINGS } from './settings-store.js';
export { UpdateUIController } from './update-ui-controller.js';
export { VersionService } from './version-service.js';

export function getElectronAutoUpdater(): AppUpdaterLike {
  const { autoUpdater } = electronUpdater;
  return autoUpdater as unknown as AppUpdaterLike;
}
