import type { RemoteControlKeyboardEvent, RemoteControlRequest } from '@professor-connect/protocol';

import { formatKeyboardEventLog, identifyShortcut } from '../remote-input/input-events.js';
import type {
  NativeKeyboardKey,
  RemoteKeyboardAdapter,
  RemoteKeyboardLogger,
} from './remote-keyboard.types.js';

const NAMED_VIRTUAL_KEYS: Readonly<Record<string, readonly [number, boolean]>> = {
  Backspace: [0x08, false],
  Tab: [0x09, false],
  Enter: [0x0d, false],
  NumpadEnter: [0x0d, true],
  ShiftLeft: [0xa0, false],
  ShiftRight: [0xa1, false],
  ControlLeft: [0xa2, false],
  ControlRight: [0xa3, true],
  AltLeft: [0xa4, false],
  AltRight: [0xa5, true],
  Escape: [0x1b, false],
  Space: [0x20, false],
  Delete: [0x2e, true],
  MetaLeft: [0x5b, true],
  MetaRight: [0x5c, true],
};

export type RemoteKeyboardEventLog = string;

export interface RemoteKeyboardControllerPort {
  start(reference: RemoteControlRequest): void;
  receive(event: RemoteControlKeyboardEvent): readonly RemoteKeyboardEventLog[];
  stop(): void;
  isActive(): boolean;
}

export class RemoteKeyboardController implements RemoteKeyboardControllerPort {
  private activeReference: RemoteControlRequest | undefined;
  private readonly pressedKeys = new Map<string, NativeKeyboardKey>();

  public constructor(
    private readonly adapter: RemoteKeyboardAdapter,
    private readonly logger: RemoteKeyboardLogger = consoleRemoteKeyboardLogger,
  ) {}

  public start(reference: RemoteControlRequest): void {
    this.activeReference = { ...reference };
    this.logger.info('Controle iniciado', {
      sessionId: reference.sessionId,
      requestId: reference.requestId,
    });
  }

  public receive(event: RemoteControlKeyboardEvent): readonly RemoteKeyboardEventLog[] {
    const reference = this.activeReference;
    if (reference === undefined) {
      throw new Error('Controle de teclado não está autorizado');
    }

    const eventLog = formatKeyboardEventLog(event);
    const shortcut = identifyShortcut(event);
    const logs = [eventLog];
    this.logger.info(
      event.type === 'keydown' ? 'KeyDown' : event.type === 'keyup' ? 'KeyUp' : 'KeyPress',
      {
        ...reference,
        key: event.key,
        code: event.code,
        repeat: event.repeat,
      },
    );

    if (shortcut !== undefined) {
      const suffix = shortcut.supported ? '' : ' (não suportado pelo sistema operacional)';
      logs.push(`Shortcut: ${shortcut.name}${suffix}`);
      this.logger.info('Shortcut', {
        ...reference,
        shortcut: shortcut.name,
        supported: shortcut.supported,
      });
    }

    // keypress é mantido no protocolo apenas para compatibilidade. A injeção ocorre
    // em keydown/keyup, evitando caracteres duplicados.
    if (event.type === 'keypress') {
      return logs;
    }

    // A sequência de atenção segura não pode ser criada por SendInput no Windows.
    if (shortcut?.name === 'Ctrl+Alt+Delete') {
      return logs;
    }

    try {
      const key = resolveNativeKey(event.code);
      if (event.type === 'keydown') {
        this.adapter.keyDown(key);
        this.pressedKeys.set(key.code, key);
      } else {
        const pressed = this.pressedKeys.get(key.code);
        if (pressed !== undefined) {
          this.adapter.keyUp(pressed);
          this.pressedKeys.delete(key.code);
        }
      }
      return logs;
    } catch (error) {
      this.logger.error('Erro de execução', error);
      this.stop();
      throw error;
    }
  }

  public stop(): void {
    const reference = this.activeReference;
    this.activeReference = undefined;

    for (const key of [...this.pressedKeys.values()].reverse()) {
      try {
        this.adapter.keyUp(key);
      } catch (error) {
        this.logger.error('Erro de execução ao liberar tecla', error);
      }
    }
    this.pressedKeys.clear();

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
}

export function resolveNativeKey(code: string): NativeKeyboardKey {
  if (/^Key[A-Z]$/.test(code)) {
    return { code, virtualKey: code.charCodeAt(3), extended: false };
  }
  if (/^Digit[0-9]$/.test(code)) {
    return { code, virtualKey: code.charCodeAt(5), extended: false };
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return { code, virtualKey: 0x60 + Number(code.at(-1)), extended: false };
  }
  const named = NAMED_VIRTUAL_KEYS[code];
  if (named !== undefined) {
    return { code, virtualKey: named[0], extended: named[1] };
  }
  throw new Error(`Tecla não suportada para controle remoto: ${code}`);
}

const consoleRemoteKeyboardLogger: RemoteKeyboardLogger = {
  info(message, context): void {
    console.info(`[remote-keyboard] ${message}`, context ?? {});
  },
  error(message, error): void {
    console.error(`[remote-keyboard] ${message}`, error);
  },
};
