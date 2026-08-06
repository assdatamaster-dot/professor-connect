import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { UPDATE_CHANNELS, type UpdateSettings, type UpdateSettingsInput } from './contracts.js';

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = Object.freeze({
  automaticDownload: true,
  channel: 'stable',
  checkIntervalMinutes: 60,
  installOnlyOutsideAttendance: true,
  installOnAppQuit: true,
});

export class UpdateSettingsStore {
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'update-manager', 'settings.json');
  }

  public async get(): Promise<UpdateSettings> {
    try {
      return validate(JSON.parse(await readFile(this.filePath, 'utf8')) as UpdateSettingsInput);
    } catch {
      return DEFAULT_UPDATE_SETTINGS;
    }
  }

  public async save(input: UpdateSettingsInput): Promise<UpdateSettings> {
    const settings = validate({ ...(await this.get()), ...input });
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
    return settings;
  }
}

function validate(input: UpdateSettingsInput): UpdateSettings {
  const interval = input.checkIntervalMinutes ?? DEFAULT_UPDATE_SETTINGS.checkIntervalMinutes;
  return Object.freeze({
    automaticDownload: input.automaticDownload !== false,
    channel:
      input.channel !== undefined && UPDATE_CHANNELS.some((item) => item === input.channel)
        ? input.channel
        : DEFAULT_UPDATE_SETTINGS.channel,
    checkIntervalMinutes:
      Number.isInteger(interval) && interval >= 15 && interval <= 1_440
        ? interval
        : DEFAULT_UPDATE_SETTINGS.checkIntervalMinutes,
    installOnlyOutsideAttendance: true as const,
    installOnAppQuit: input.installOnAppQuit !== false,
  });
}
