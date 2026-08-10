import type { WebContents } from 'electron';

import { UpdateAuditReporter } from './audit-reporter.js';
import type {
  AppUpdaterLike,
  BuildIdentity,
  DownloadedUpdateInfoLike,
  ProgressInfoLike,
  UpdateApplication,
  UpdateInfoLike,
  UpdateSettings,
  UpdateSettingsInput,
  UpdateState,
} from './contracts.js';
import { DownloadManager } from './download-manager.js';
import { InstallManager } from './install-manager.js';
import { ReleaseNotesService } from './release-notes-service.js';
import { RollbackManager } from './rollback-manager.js';
import { UpdateSettingsStore } from './settings-store.js';
import { UpdateChecker } from './update-checker.js';
import { UpdateFileLogger } from './update-file-logger.js';
import { VersionService } from './version-service.js';

export interface UpdateManagerOptions {
  readonly updater: AppUpdaterLike;
  readonly application: UpdateApplication;
  readonly currentVersion: string;
  readonly userDataPath: string;
  readonly serverUrl: string;
  readonly isPackaged: boolean;
  readonly quitApplication: () => void;
  readonly webContents: () => WebContents | undefined;
  readonly buildIdentity: BuildIdentity;
  readonly updateUrl: string;
  readonly startupDelayMilliseconds?: number;
  readonly healthCheckMilliseconds?: number;
}

type StateListener = (state: UpdateState) => void;

export class UpdateManager {
  private readonly checker: UpdateChecker;
  private readonly downloads: DownloadManager;
  private readonly installer: InstallManager;
  private readonly releaseNotes = new ReleaseNotesService();
  private readonly rollback: RollbackManager;
  private readonly settingsStore: UpdateSettingsStore;
  private readonly versions: VersionService;
  private readonly logger: UpdateFileLogger;
  private readonly listeners = new Set<StateListener>();
  private audit: UpdateAuditReporter | undefined;
  private settings: UpdateSettings | undefined;
  private checkTimer: NodeJS.Timeout | undefined;
  private healthTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private startupTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private updateAvailableAt = 0;
  private installPendingAfterAttendance = false;
  private healthPending = false;
  private state: UpdateState;

  public constructor(private readonly options: UpdateManagerOptions) {
    if (options.buildIdentity.version !== options.currentVersion) {
      throw new Error('Versão do aplicativo diverge da identidade do build');
    }
    this.versions = new VersionService(options.currentVersion, options.userDataPath);
    this.checker = new UpdateChecker(options.updater, this.versions);
    this.downloads = new DownloadManager(options.updater);
    this.installer = new InstallManager(options.updater);
    this.rollback = new RollbackManager(options.userDataPath);
    this.settingsStore = new UpdateSettingsStore(options.userDataPath);
    this.state = {
      phase: 'idle',
      currentVersion: options.currentVersion,
      newVersion: undefined,
      releaseDate: undefined,
      releaseNotes: undefined,
      progress: undefined,
      attendanceActive: false,
      message: 'Atualizações automáticas ativas',
      errorCode: undefined,
      lastCheckedAt: undefined,
      buildIdentity: options.buildIdentity,
      updateUrl: options.updateUrl,
    };
    this.logger = new UpdateFileLogger(options.userDataPath);
    options.updater.logger = this.logger;
    options.updater.autoDownload = false;
    this.registerUpdaterEvents();
  }

  public async start(): Promise<void> {
    this.settings = await this.settingsStore.get();
    this.checker.configure(this.settings.channel);
    this.logger.info(
      `[UPDATE] versão instalada=${this.options.currentVersion} app=${this.options.application} gitSha=${this.options.buildIdentity.gitSha} buildId=${this.options.buildIdentity.buildId} dirty=${this.options.buildIdentity.dirty}`,
    );
    this.logger.info(
      `[UPDATE] URL=${this.options.updateUrl} canal=${this.settings.channel} packaged=${this.options.isPackaged}`,
    );
    this.logger.info(`[UPDATE] versão final=${this.options.currentVersion}`);
    this.installer.configureInstallOnQuit(
      this.settings.installOnAppQuit,
      this.state.attendanceActive,
    );
    const installationId = await this.versions.installationId();
    this.audit = new UpdateAuditReporter(
      this.options.serverUrl,
      this.options.application,
      installationId,
      () => this.requireSettings().channel,
    );
    const startup = await this.rollback.handleStartup(this.options.currentVersion);
    if (startup === 'rollback-started') {
      await this.audit.report({ event: 'rollback', newVersion: this.options.currentVersion });
      this.options.quitApplication();
      return;
    }
    if (startup === 'pending-health-check') {
      this.healthPending = true;
      this.healthTimer = setTimeout(() => {
        void this.rollback.markHealthy(this.options.currentVersion).then(() => {
          this.healthPending = false;
          return this.audit?.report({
            event: 'installation_healthy',
            newVersion: this.options.currentVersion,
          });
        });
      }, this.options.healthCheckMilliseconds ?? 30_000);
    }
    if (!this.options.isPackaged) {
      this.patch({
        phase: 'disabled',
        message: 'Atualizações são verificadas somente no aplicativo instalado',
      });
      return;
    }
    this.scheduleChecks();
    this.startupTimer = setTimeout(
      () => void this.check().catch(() => undefined),
      this.options.startupDelayMilliseconds ?? 3_000,
    );
  }

  public getState(): UpdateState {
    return this.state;
  }

  public async getSettings(): Promise<UpdateSettings> {
    return this.settings ?? this.settingsStore.get();
  }

  public async saveSettings(input: UpdateSettingsInput): Promise<UpdateSettings> {
    const previousChannel = this.requireSettings().channel;
    this.settings = await this.settingsStore.save(input);
    this.checker.configure(this.settings.channel);
    this.installer.configureInstallOnQuit(
      this.settings.installOnAppQuit,
      this.state.attendanceActive,
    );
    this.scheduleChecks();
    if (previousChannel !== this.settings.channel && this.options.isPackaged) {
      void this.check().catch(() => undefined);
    }
    return this.settings;
  }

  public async check(): Promise<UpdateState> {
    if (!this.options.isPackaged) return this.state;
    this.logger.info(
      `[UPDATE] verificando atualização versão=${this.options.currentVersion} URL=${this.options.updateUrl} canal=${this.requireSettings().channel}`,
    );
    await this.audit?.report({
      event: 'check_started',
      previousVersion: this.options.currentVersion,
    });
    try {
      await this.checker.check();
    } catch (error) {
      this.handleError(error);
    }
    return this.state;
  }

  public async download(): Promise<UpdateState> {
    if (this.state.phase !== 'available' && this.state.phase !== 'error') return this.state;
    this.patch({ phase: 'downloading', message: 'Baixando atualização em segundo plano…' });
    this.logger.info(`[UPDATE] download iniciado versão=${this.state.newVersion ?? 'unknown'}`);
    await this.audit?.report({
      event: 'download_started',
      previousVersion: this.options.currentVersion,
      ...(this.state.newVersion === undefined ? {} : { newVersion: this.state.newVersion }),
    });
    try {
      await this.downloads.download();
    } catch (error) {
      this.handleError(error);
    }
    return this.state;
  }

  public async install(): Promise<UpdateState> {
    if (this.state.phase !== 'downloaded' && this.state.phase !== 'deferred') return this.state;
    if (this.state.attendanceActive) {
      this.installPendingAfterAttendance = true;
      this.patch({
        phase: 'deferred',
        message: 'A atualização será instalada automaticamente quando o atendimento for encerrado.',
      });
      return this.state;
    }
    const newVersion = this.state.newVersion;
    if (newVersion === undefined) return this.state;
    await this.rollback.markInstallationPending(newVersion);
    await this.audit?.report({
      event: 'installation_started',
      previousVersion: this.options.currentVersion,
      newVersion,
    });
    this.patch({ phase: 'installing', message: 'Instalando atualização com segurança…' });
    this.logger.info(`[UPDATE] instalação versão=${newVersion}; reinício solicitado`);
    this.installer.install(false);
    return this.state;
  }

  public defer(): UpdateState {
    if (this.state.phase === 'downloaded') {
      this.patch({ message: 'A atualização será instalada ao fechar o aplicativo.' });
    }
    return this.state;
  }

  public setAttendanceActive(active: boolean): void {
    if (this.state.attendanceActive === active) return;
    this.patch({ attendanceActive: active });
    const settings = this.settings;
    if (settings === undefined) return;
    this.installer.configureInstallOnQuit(settings.installOnAppQuit, active);
    if (active && this.state.phase === 'downloaded') {
      this.installPendingAfterAttendance = true;
      this.patch({
        phase: 'deferred',
        message: 'A atualização será instalada automaticamente quando o atendimento for encerrado.',
      });
    }
    if (!active && this.installPendingAfterAttendance && this.state.phase === 'deferred') {
      this.installPendingAfterAttendance = false;
      setTimeout(() => void this.install(), 1_000);
    }
  }

  public onStateChanged(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async reportFatalStartupFailure(): Promise<void> {
    if (!this.healthPending) return;
    if (await this.rollback.rollbackNow()) {
      await this.audit?.report({ event: 'rollback', newVersion: this.options.currentVersion });
      this.options.quitApplication();
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.checkTimer !== undefined) clearInterval(this.checkTimer);
    if (this.healthTimer !== undefined) clearTimeout(this.healthTimer);
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    if (this.startupTimer !== undefined) clearTimeout(this.startupTimer);
    this.options.updater.removeAllListeners();
    this.listeners.clear();
  }

  public flushLogs(): Promise<void> {
    return this.logger.flush();
  }

  private registerUpdaterEvents(): void {
    this.options.updater.on('checking-for-update', () => {
      this.logger.info('[UPDATE] electron-updater iniciou consulta ao feed');
      this.patch({ phase: 'checking', message: 'Verificando atualizações…', errorCode: undefined });
    });
    this.options.updater.on('update-available', (info) => void this.onUpdateAvailable(info));
    this.options.updater.on('update-not-available', () => {
      this.logger.info(`[UPDATE] nenhuma versão nova; instalada=${this.options.currentVersion}`);
      const checkedAt = new Date().toISOString();
      this.patch({
        phase: 'up-to-date',
        message: 'Professor Connect está atualizado',
        lastCheckedAt: checkedAt,
        errorCode: undefined,
      });
      void this.audit?.report({
        event: 'up_to_date',
        previousVersion: this.options.currentVersion,
      });
    });
    this.options.updater.on('download-progress', (progress) => this.onProgress(progress));
    this.options.updater.on('update-downloaded', (info) => void this.onDownloaded(info));
    this.options.updater.on('error', (error) => this.handleError(error));
  }

  private async onUpdateAvailable(info: UpdateInfoLike): Promise<void> {
    this.logger.info(
      `[UPDATE] versão encontrada=${info.version} instalada=${this.options.currentVersion}`,
    );
    this.updateAvailableAt = Date.now();
    this.patch({
      phase: 'available',
      newVersion: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: this.releaseNotes.parse(info.releaseNotes),
      message: this.requireSettings().automaticDownload
        ? 'Nova versão encontrada. Preparando download…'
        : 'Nova versão disponível',
      lastCheckedAt: new Date().toISOString(),
      errorCode: undefined,
    });
    await this.audit?.report({
      event: 'update_available',
      previousVersion: this.options.currentVersion,
      newVersion: info.version,
    });
    if (this.requireSettings().automaticDownload) await this.download();
  }

  private onProgress(progress: ProgressInfoLike): void {
    const bytesPerSecond = Math.max(0, progress.bytesPerSecond);
    const remainingBytes = Math.max(0, progress.total - progress.transferred);
    this.patch({
      phase: 'downloading',
      progress: {
        percent: Math.min(100, Math.max(0, progress.percent)),
        bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
        remainingSeconds:
          bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : undefined,
      },
      message: 'Atualizando Professor Connect…',
    });
  }

  private async onDownloaded(info: DownloadedUpdateInfoLike): Promise<void> {
    try {
      await this.rollback.prepareCandidate(
        info.version,
        info.downloadedFile,
        info.files?.[0]?.sha512,
      );
      this.logger.info(`[UPDATE] download concluído versão=${info.version}; integridade validada`);
      const deferred = this.state.attendanceActive;
      this.installPendingAfterAttendance = deferred;
      this.patch({
        phase: deferred ? 'deferred' : 'downloaded',
        newVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: this.releaseNotes.parse(info.releaseNotes),
        progress: undefined,
        message: deferred
          ? 'A atualização será instalada automaticamente quando o atendimento for encerrado.'
          : 'Nova versão pronta.',
      });
      await this.audit?.report({
        event: 'download_completed',
        previousVersion: this.options.currentVersion,
        newVersion: info.version,
        durationMilliseconds: Math.max(0, Date.now() - this.updateAvailableAt),
      });
    } catch (error) {
      this.handleError(error, 'integrity_failed');
    }
  }

  private handleError(error: unknown, code = 'update_failed'): void {
    const message = error instanceof Error ? error.message : 'Falha desconhecida na atualização';
    this.logger.error(`[UPDATE] falha code=${code} message=${message}`);
    this.patch({
      phase: 'error',
      message: 'Não foi possível atualizar agora. Tentaremos novamente.',
      errorCode: code,
    });
    void this.audit?.report({
      event: 'failure',
      previousVersion: this.options.currentVersion,
      ...(this.state.newVersion === undefined ? {} : { newVersion: this.state.newVersion }),
      error: message.slice(0, 500),
    });
    if (this.options.isPackaged && !this.disposed) {
      if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.check().catch(() => undefined), 5 * 60_000);
    }
  }

  private scheduleChecks(): void {
    if (this.checkTimer !== undefined) clearInterval(this.checkTimer);
    if (!this.options.isPackaged) return;
    this.checkTimer = setInterval(
      () => void this.check().catch(() => undefined),
      this.requireSettings().checkIntervalMinutes * 60_000,
    );
  }

  private requireSettings(): UpdateSettings {
    if (this.settings === undefined) throw new Error('Update Manager ainda não foi inicializado');
    return this.settings;
  }

  private patch(patch: Partial<UpdateState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener(this.state);
    const contents = this.options.webContents();
    if (contents !== undefined && !contents.isDestroyed()) {
      contents.send('update-manager:state-changed', this.state);
    }
  }
}
