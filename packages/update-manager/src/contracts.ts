export const UPDATE_CHANNELS = ['stable', 'beta', 'development'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];
export type UpdateApplication = 'teacher' | 'student';

export interface BuildIdentity {
  readonly application: UpdateApplication;
  readonly version: string;
  readonly gitSha: string;
  readonly buildDate: string;
  readonly buildId: string;
  readonly dirty: boolean;
}

export const UPDATE_IPC_CHANNELS = Object.freeze({
  getState: 'update-manager:get-state',
  check: 'update-manager:check',
  download: 'update-manager:download',
  getSettings: 'update-manager:get-settings',
  saveSettings: 'update-manager:save-settings',
  install: 'update-manager:install',
  defer: 'update-manager:defer',
  stateChanged: 'update-manager:state-changed',
});

export interface UpdateSettings {
  readonly automaticDownload: boolean;
  readonly channel: UpdateChannel;
  readonly checkIntervalMinutes: number;
  readonly installOnlyOutsideAttendance: true;
  readonly installOnAppQuit: boolean;
}

export interface UpdateReleaseNotes {
  readonly news: readonly string[];
  readonly fixes: readonly string[];
  readonly improvements: readonly string[];
  readonly raw: string;
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'deferred'
  | 'installing'
  | 'up-to-date'
  | 'disabled'
  | 'error';

export interface UpdateProgress {
  readonly percent: number;
  readonly bytesPerSecond: number;
  readonly transferred: number;
  readonly total: number;
  readonly remainingSeconds: number | undefined;
}

export interface UpdateState {
  readonly phase: UpdatePhase;
  readonly currentVersion: string;
  readonly newVersion: string | undefined;
  readonly releaseDate: string | undefined;
  readonly releaseNotes: UpdateReleaseNotes | undefined;
  readonly progress: UpdateProgress | undefined;
  readonly attendanceActive: boolean;
  readonly message: string;
  readonly errorCode: string | undefined;
  readonly lastCheckedAt: string | undefined;
  readonly buildIdentity: BuildIdentity;
  readonly updateUrl: string;
}

export interface UpdateSettingsInput {
  readonly automaticDownload?: boolean;
  readonly channel?: UpdateChannel;
  readonly checkIntervalMinutes?: number;
  readonly installOnAppQuit?: boolean;
}

export interface UpdateRendererApi {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  getSettings(): Promise<UpdateSettings>;
  saveSettings(input: UpdateSettingsInput): Promise<UpdateSettings>;
  install(): Promise<UpdateState>;
  defer(): Promise<UpdateState>;
  onStateChanged(listener: (state: UpdateState) => void): () => void;
}

export interface UpdateInfoLike {
  readonly version: string;
  readonly releaseDate?: string;
  readonly releaseNotes?: string | readonly { readonly note: string }[] | null;
  readonly files?: readonly { readonly url?: string; readonly sha512?: string }[];
}

export interface DownloadedUpdateInfoLike extends UpdateInfoLike {
  readonly downloadedFile?: string;
}

export interface ProgressInfoLike {
  readonly percent: number;
  readonly bytesPerSecond: number;
  readonly transferred: number;
  readonly total: number;
}

export interface AppUpdaterLike {
  logger?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  } | null;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<readonly string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'checking-for-update', listener: () => void): this;
  on(
    event: 'update-available' | 'update-not-available',
    listener: (info: UpdateInfoLike) => void,
  ): this;
  on(event: 'download-progress', listener: (progress: ProgressInfoLike) => void): this;
  on(event: 'update-downloaded', listener: (info: DownloadedUpdateInfoLike) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  removeAllListeners(event?: string): this;
}
