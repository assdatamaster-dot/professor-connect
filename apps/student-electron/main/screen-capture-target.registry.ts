import type { DesktopCapturerSource, Display, Screen } from 'electron';

import type { AllScreensCaptureLayout } from '../shared/screen-capture-contracts.js';
import type {
  RemoteMouseBounds,
  RemoteMouseBoundsProvider,
  RemoteMouseRegion,
} from './remote-mouse/remote-mouse.types.js';

interface SelectedDisplay {
  readonly displayId: string;
  readonly sourceName: string;
}

interface PhysicalDisplay {
  readonly displayId: string;
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export class ScreenCaptureTargetRegistry implements RemoteMouseBoundsProvider {
  private selectedDisplays: readonly SelectedDisplay[] = [];

  public constructor(private readonly electronScreen: Screen) {}

  public selectAll(sources: readonly DesktopCapturerSource[]): AllScreensCaptureLayout {
    const displays = this.electronScreen.getAllDisplays();
    const selected = displays.map((display) => {
      const source = findSourceForDisplay(sourceSources(sources), display, displays.length);
      return { display, source };
    });
    if (selected.length === 0) {
      throw new Error('Nenhum monitor foi encontrado para compartilhamento');
    }

    this.selectedDisplays = selected.map(({ display, source }) => ({
      displayId: String(display.id),
      sourceName: source.name,
    }));
    return createLayout(
      selected.map(({ display, source }) => this.toPhysicalDisplay(display, source.name)),
    );
  }

  public clear(): void {
    this.selectedDisplays = [];
  }

  public getBounds(): RemoteMouseBounds {
    if (this.selectedDisplays.length === 0) {
      throw new Error('Compartilhe todos os monitores antes de permitir o controle remoto');
    }

    const availableDisplays = this.electronScreen.getAllDisplays();
    const physicalDisplays = this.selectedDisplays.map((selected) => {
      const display = availableDisplays.find(
        (candidate) => String(candidate.id) === selected.displayId,
      );
      if (display === undefined) {
        throw new Error('A configuração dos monitores mudou durante o controle remoto');
      }
      return this.toPhysicalDisplay(display, selected.sourceName);
    });
    return createRemoteMouseBounds(physicalDisplays);
  }

  private toPhysicalDisplay(display: Display, name: string): PhysicalDisplay {
    const origin = this.electronScreen.dipToScreenPoint({
      x: display.bounds.x,
      y: display.bounds.y,
    });
    return {
      displayId: String(display.id),
      name,
      left: Math.round(origin.x),
      top: Math.round(origin.y),
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    };
  }
}

function sourceSources(
  sources: readonly DesktopCapturerSource[],
): readonly DesktopCapturerSource[] {
  return sources.filter((source) => source.id.startsWith('screen:'));
}

function findSourceForDisplay(
  sources: readonly DesktopCapturerSource[],
  display: Display,
  displayCount: number,
): DesktopCapturerSource {
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ??
    (displayCount === 1 ? sources[0] : undefined);
  if (source === undefined) {
    throw new Error(`Não foi possível localizar a fonte do monitor ${display.label || display.id}`);
  }
  return source;
}

function createLayout(displays: readonly PhysicalDisplay[]): AllScreensCaptureLayout {
  const bounds = calculateUnion(displays);
  return {
    width: bounds.width,
    height: bounds.height,
    displays: displays
      .map((display) => ({
        displayId: display.displayId,
        name: display.name,
        x: display.left - bounds.left,
        y: display.top - bounds.top,
        width: display.width,
        height: display.height,
      }))
      .sort((left, right) => left.y - right.y || left.x - right.x),
  };
}

function createRemoteMouseBounds(displays: readonly PhysicalDisplay[]): RemoteMouseBounds {
  const bounds = calculateUnion(displays);
  const regions: RemoteMouseRegion[] = displays.map((display) => ({
    left: display.left,
    top: display.top,
    width: display.width,
    height: display.height,
  }));
  return {
    ...bounds,
    sourceName: `${displays.length} monitor(es)`,
    regions,
  };
}

function calculateUnion(
  displays: readonly Pick<PhysicalDisplay, 'left' | 'top' | 'width' | 'height'>[],
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  if (displays.length === 0) {
    throw new Error('Nenhum monitor disponível');
  }
  const left = Math.min(...displays.map((display) => display.left));
  const top = Math.min(...displays.map((display) => display.top));
  const right = Math.max(...displays.map((display) => display.left + display.width));
  const bottom = Math.max(...displays.map((display) => display.top + display.height));
  return { left, top, width: right - left, height: bottom - top };
}
