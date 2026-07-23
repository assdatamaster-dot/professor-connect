import type { DesktopCapturerSource } from 'electron';

import type { AllScreensCaptureLayout } from '../shared/screen-capture-contracts.js';
import type { ScreenCaptureTargetRegistry } from './screen-capture-target.registry.js';

export type DesktopSourcesProvider = () => Promise<DesktopCapturerSource[]>;

export class AllScreensCaptureCoordinator {
  private pendingSources: DesktopCapturerSource[] = [];

  public constructor(
    private readonly getScreenSources: DesktopSourcesProvider,
    private readonly targetRegistry: ScreenCaptureTargetRegistry,
  ) {}

  public async prepare(): Promise<AllScreensCaptureLayout> {
    const sources = (await this.getScreenSources()).filter((source) =>
      source.id.startsWith('screen:'),
    );
    const layout = this.targetRegistry.selectAll(sources);
    this.pendingSources = layout.displays.map((display) => {
      const source = sources.find((candidate) => candidate.display_id === display.displayId);
      if (source === undefined) {
        if (sources.length === 1) {
          return sources[0]!;
        }
        throw new Error(`Fonte de captura ausente para o monitor ${display.name}`);
      }
      return source;
    });
    return layout;
  }

  public takeNextSource(): DesktopCapturerSource | undefined {
    return this.pendingSources.shift();
  }

  public hasPendingSource(): boolean {
    return this.pendingSources.length > 0;
  }

  public clear(): void {
    this.pendingSources = [];
    this.targetRegistry.clear();
  }
}
