export interface ReconnectSettings {
  readonly reconnectAttempts?: number;
  readonly reconnectDelayMs?: number;
  readonly reconnectDelayMaxMs?: number;
  readonly connectTimeoutMs?: number;
}

export interface ResolvedReconnectSettings {
  readonly attempts: number;
  readonly initialDelayMs: number;
  readonly maximumDelayMs: number;
  readonly connectTimeoutMs: number;
}

/** Shared exponential-backoff policy used by both desktop clients. */
export class ReconnectService {
  public readonly settings: ResolvedReconnectSettings;

  public constructor(settings: ReconnectSettings = {}) {
    this.settings = {
      attempts: settings.reconnectAttempts ?? 10,
      initialDelayMs: settings.reconnectDelayMs ?? 1_000,
      maximumDelayMs: settings.reconnectDelayMaxMs ?? 30_000,
      connectTimeoutMs: settings.connectTimeoutMs ?? 10_000,
    };
  }

  public delayForAttempt(attempt: number): number {
    return Math.min(
      this.settings.maximumDelayMs,
      this.settings.initialDelayMs * 2 ** Math.max(0, attempt - 1),
    );
  }
}
