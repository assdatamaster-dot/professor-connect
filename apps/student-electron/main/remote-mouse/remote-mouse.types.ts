export interface RemoteMouseBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly sourceName: string;
  readonly regions?: readonly RemoteMouseRegion[];
}

export interface RemoteMouseRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface RemoteMouseBoundsProvider {
  getBounds(): RemoteMouseBounds;
}

export type RemoteMouseButton = 'left' | 'right';

export interface RemoteMouseAdapter {
  moveTo(x: number, y: number): void;
  buttonDown(button: RemoteMouseButton): void;
  buttonUp(button: RemoteMouseButton): void;
  scroll(horizontalDelta: number, verticalDelta: number): void;
}

export interface RemoteMouseLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}
