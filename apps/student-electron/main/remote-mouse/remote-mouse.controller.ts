import type { RemoteControlMouseEvent, RemoteControlRequest } from '@professor-connect/protocol';

import type {
  RemoteMouseAdapter,
  RemoteMouseBounds,
  RemoteMouseBoundsProvider,
  RemoteMouseButton,
  RemoteMouseLogger,
} from './remote-mouse.types.js';

const WINDOWS_WHEEL_DELTA = 120;
const PIXELS_PER_WHEEL_NOTCH = 100;
const LINES_PER_WHEEL_NOTCH = 3;

export type RemoteMouseEventLog =
  'MouseMove' | 'ClickLeft' | 'ClickRight' | 'DoubleClick' | 'Wheel' | undefined;

export interface RemoteMouseControllerPort {
  start(reference: RemoteControlRequest): void;
  receive(event: RemoteControlMouseEvent): RemoteMouseEventLog;
  stop(): void;
  isActive(): boolean;
}

export class RemoteMouseController implements RemoteMouseControllerPort {
  private activeReference: RemoteControlRequest | undefined;
  private readonly pressedButtons = new Set<RemoteMouseButton>();

  public constructor(
    private readonly adapter: RemoteMouseAdapter,
    private readonly boundsProvider: RemoteMouseBoundsProvider,
    private readonly logger: RemoteMouseLogger = consoleRemoteMouseLogger,
  ) {}

  public start(reference: RemoteControlRequest): void {
    const bounds = this.requireValidBounds();
    this.activeReference = { ...reference };
    this.logger.info('Controle iniciado', {
      sessionId: reference.sessionId,
      requestId: reference.requestId,
      target: bounds.sourceName,
      width: bounds.width,
      height: bounds.height,
    });
  }

  public receive(event: RemoteControlMouseEvent): RemoteMouseEventLog {
    const reference = this.activeReference;
    if (reference === undefined) {
      throw new Error('Controle de mouse não está autorizado');
    }

    try {
      const bounds = this.requireValidBounds();
      const point = mapNormalizedPoint(event.x, event.y, bounds);
      this.adapter.moveTo(point.x, point.y);

      switch (event.type) {
        case 'mousemove':
          this.logEvent('MouseMove', reference, point);
          return 'MouseMove';
        case 'mousedown': {
          const button = requireSupportedButton(event.button);
          this.adapter.buttonDown(button);
          this.pressedButtons.add(button);
          return undefined;
        }
        case 'mouseup': {
          const button = requireSupportedButton(event.button);
          this.adapter.buttonUp(button);
          this.pressedButtons.delete(button);
          const message = button === 'left' ? 'ClickLeft' : 'ClickRight';
          this.logEvent(message, reference, point);
          return message;
        }
        case 'dblclick':
          this.logEvent('DoubleClick', reference, point);
          return 'DoubleClick';
        case 'wheel': {
          const horizontalDelta = normalizeWheelDelta(event.deltaX ?? 0, event.deltaMode ?? 0);
          const verticalDelta = normalizeWheelDelta(event.deltaY ?? 0, event.deltaMode ?? 0);
          this.adapter.scroll(
            horizontalDelta === 0 ? 0 : -horizontalDelta,
            verticalDelta === 0 ? 0 : -verticalDelta,
          );
          this.logEvent('Wheel', reference, point);
          return 'Wheel';
        }
      }
    } catch (error) {
      this.logger.error('Erro de execução', error);
      this.stop();
      throw error;
    }
  }

  public stop(): void {
    const reference = this.activeReference;
    this.activeReference = undefined;

    for (const button of this.pressedButtons) {
      try {
        this.adapter.buttonUp(button);
      } catch (error) {
        this.logger.error('Erro de execução ao liberar botão do mouse', error);
      }
    }
    this.pressedButtons.clear();

    if (reference !== undefined) {
      this.logger.info('Controle encerrado', {
        sessionId: reference.sessionId,
        requestId: reference.requestId,
      });
    }
  }

  public isActive(): boolean {
    return this.activeReference !== undefined;
  }

  private requireValidBounds(): RemoteMouseBounds {
    const bounds = this.boundsProvider.getBounds();
    if (
      !Number.isInteger(bounds.left) ||
      !Number.isInteger(bounds.top) ||
      !Number.isInteger(bounds.width) ||
      !Number.isInteger(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      throw new Error('Limites físicos da tela compartilhada são inválidos');
    }
    return bounds;
  }

  private logEvent(
    message: Exclude<RemoteMouseEventLog, undefined>,
    reference: RemoteControlRequest,
    point: { readonly x: number; readonly y: number },
  ): void {
    this.logger.info(message, {
      sessionId: reference.sessionId,
      requestId: reference.requestId,
      x: point.x,
      y: point.y,
    });
  }
}

export function mapNormalizedPoint(
  normalizedX: number,
  normalizedY: number,
  bounds: RemoteMouseBounds,
): { readonly x: number; readonly y: number } {
  if (
    !Number.isFinite(normalizedX) ||
    !Number.isFinite(normalizedY) ||
    normalizedX < 0 ||
    normalizedX > 1 ||
    normalizedY < 0 ||
    normalizedY > 1
  ) {
    throw new Error('Coordenadas normalizadas do mouse são inválidas');
  }

  const point = {
    x: bounds.left + Math.round(normalizedX * Math.max(bounds.width - 1, 0)),
    y: bounds.top + Math.round(normalizedY * Math.max(bounds.height - 1, 0)),
  };
  return clampPointToRegions(point, bounds.regions);
}

function clampPointToRegions(
  point: { readonly x: number; readonly y: number },
  regions: RemoteMouseBounds['regions'],
): { readonly x: number; readonly y: number } {
  if (regions === undefined || regions.length === 0) {
    return point;
  }
  if (
    regions.some(
      (region) =>
        point.x >= region.left &&
        point.x < region.left + region.width &&
        point.y >= region.top &&
        point.y < region.top + region.height,
    )
  ) {
    return point;
  }

  const closest = regions
    .map((region) => {
      const x = clampInteger(point.x, region.left, region.left + region.width - 1);
      const y = clampInteger(point.y, region.top, region.top + region.height - 1);
      return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
    })
    .sort((left, right) => left.distance - right.distance)[0]!;
  return { x: closest.x, y: closest.y };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function requireSupportedButton(button: number): RemoteMouseButton {
  if (button === 0) {
    return 'left';
  }
  if (button === 2) {
    return 'right';
  }
  throw new Error('Somente os botões esquerdo e direito estão autorizados nesta versão');
}

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (delta === 0) {
    return 0;
  }
  const divisor =
    deltaMode === 1 ? LINES_PER_WHEEL_NOTCH : deltaMode === 2 ? 1 : PIXELS_PER_WHEEL_NOTCH;
  const normalized = Math.round((delta / divisor) * WINDOWS_WHEEL_DELTA);
  return normalized === 0 ? Math.sign(delta) * WINDOWS_WHEEL_DELTA : normalized;
}

const consoleRemoteMouseLogger: RemoteMouseLogger = {
  info(message, context): void {
    console.info(`[remote-mouse] ${message}`, context ?? {});
  },
  error(message, error): void {
    console.error(`[remote-mouse] ${message}`, error);
  },
};
