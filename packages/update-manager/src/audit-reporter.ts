import type { UpdateApplication, UpdateChannel } from './contracts.js';

export interface UpdateAuditEvent {
  readonly event: string;
  readonly previousVersion?: string;
  readonly newVersion?: string;
  readonly durationMilliseconds?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class UpdateAuditReporter {
  public constructor(
    private readonly serverUrl: string,
    private readonly application: UpdateApplication,
    private readonly clientId: string,
    private readonly channel: () => UpdateChannel,
  ) {}

  public report(event: UpdateAuditEvent): void {
    void this.send(event);
  }

  private async send(event: UpdateAuditEvent): Promise<void> {
    try {
      const response = await fetch(new URL('/api/version/events', this.serverUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.clientId,
          application: this.application,
          channel: this.channel(),
          ...event,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      // Audit telemetry must never block startup or installation.
    }
  }
}
