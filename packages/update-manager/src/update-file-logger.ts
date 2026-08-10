import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export class UpdateFileLogger {
  private readonly filePath: string;
  private pending = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'update-manager', 'update.log');
  }

  public info(...args: unknown[]): void {
    this.write('info', args);
  }

  public warn(...args: unknown[]): void {
    this.write('warning', args);
  }

  public error(...args: unknown[]): void {
    this.write('error', args);
  }

  public debug(...args: unknown[]): void {
    this.write('debug', args);
  }

  public flush(): Promise<void> {
    return this.pending;
  }

  private write(level: string, args: readonly unknown[]): void {
    this.pending = this.pending
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await this.rotateIfRequired();
        const line = JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message: args.map(formatValue).join(' '),
        });
        await appendFile(this.filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
      })
      .catch(() => undefined);
  }

  private async rotateIfRequired(): Promise<void> {
    try {
      if ((await stat(this.filePath)).size < 2 * 1_024 * 1_024) return;
      await rename(this.filePath, `${this.filePath}.1`);
    } catch {
      // The file does not exist yet or is concurrently unavailable.
    }
  }
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return redactSensitive(`${value.name}: ${value.message}`);
  if (typeof value === 'string') return redactSensitive(value);
  try {
    return redactSensitive(JSON.stringify(value));
  } catch {
    return redactSensitive(String(value));
  }
}

export function redactSensitive(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(["']?(?:authorization|token|jwt|password|secret|database_url)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[REDACTED]@');
}
