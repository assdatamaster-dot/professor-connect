import type { RemoteControlKeyboardEvent } from '@professor-connect/protocol';

export interface RemoteShortcut {
  readonly name: string;
  readonly supported: boolean;
}

const CONTROL_SHORTCUTS: Readonly<Record<string, string>> = {
  KeyA: 'Ctrl+A',
  KeyC: 'Ctrl+C',
  KeyF: 'Ctrl+F',
  KeyN: 'Ctrl+N',
  KeyO: 'Ctrl+O',
  KeyP: 'Ctrl+P',
  KeyS: 'Ctrl+S',
  KeyV: 'Ctrl+V',
  KeyX: 'Ctrl+X',
  KeyY: 'Ctrl+Y',
  KeyZ: 'Ctrl+Z',
};

export function identifyShortcut(event: RemoteControlKeyboardEvent): RemoteShortcut | undefined {
  if (event.type !== 'keydown' || !event.ctrlKey) {
    return undefined;
  }
  if (event.altKey && event.code === 'Delete') {
    return { name: 'Ctrl+Alt+Delete', supported: false };
  }
  if (event.shiftKey && event.code === 'Escape') {
    return { name: 'Ctrl+Shift+Esc', supported: true };
  }
  const name = CONTROL_SHORTCUTS[event.code];
  return name === undefined ? undefined : { name, supported: true };
}

export function formatKeyboardEventLog(event: RemoteControlKeyboardEvent): string {
  const label = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key : event.code;
  if (event.type === 'keypress') {
    return `KeyPress: ${label}`;
  }
  return `${event.type === 'keydown' ? 'KeyDown' : 'KeyUp'}: ${label}`;
}
