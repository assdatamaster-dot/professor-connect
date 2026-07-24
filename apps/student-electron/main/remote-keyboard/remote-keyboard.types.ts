export interface NativeKeyboardKey {
  readonly code: string;
  readonly virtualKey: number;
  readonly extended: boolean;
}

export interface RemoteKeyboardAdapter {
  keyDown(key: NativeKeyboardKey): void;
  keyUp(key: NativeKeyboardKey): void;
}

export interface RemoteKeyboardLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, error: unknown): void;
}
