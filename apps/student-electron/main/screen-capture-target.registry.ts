import type { DesktopCapturerSource, Screen } from 'electron';

import type {
  RemoteMouseBounds,
  RemoteMouseBoundsProvider,
} from './remote-mouse/remote-mouse.types.js';

interface SelectedCaptureTarget {
  readonly kind: 'screen' | 'window';
  readonly displayId: string;
  readonly sourceName: string;
}

export class ScreenCaptureTargetRegistry implements RemoteMouseBoundsProvider {
  private selectedTarget: SelectedCaptureTarget | undefined;

  public constructor(private readonly electronScreen: Screen) {}

  public select(source: DesktopCapturerSource): void {
    this.selectedTarget = {
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      displayId: source.display_id,
      sourceName: source.name,
    };
  }

  public clear(): void {
    this.selectedTarget = undefined;
  }

  public getBounds(): RemoteMouseBounds {
    const target = this.selectedTarget;
    if (target === undefined) {
      throw new Error('Selecione e compartilhe uma tela antes de permitir o controle remoto');
    }
    if (target.kind !== 'screen') {
      throw new Error('O controle remoto exige o compartilhamento de uma tela inteira');
    }

    const displays = this.electronScreen.getAllDisplays();
    const display =
      displays.find((candidate) => String(candidate.id) === target.displayId) ??
      (displays.length === 1 ? displays[0] : undefined);
    if (display === undefined) {
      throw new Error('Não foi possível identificar o monitor compartilhado');
    }

    const origin = this.electronScreen.dipToScreenPoint({
      x: display.bounds.x,
      y: display.bounds.y,
    });
    return {
      left: Math.round(origin.x),
      top: Math.round(origin.y),
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
      sourceName: target.sourceName,
    };
  }
}
