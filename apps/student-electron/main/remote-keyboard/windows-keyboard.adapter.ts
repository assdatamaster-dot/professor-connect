import { createRequire } from 'node:module';

import type Koffi from 'koffi';

import type { NativeKeyboardKey, RemoteKeyboardAdapter } from './remote-keyboard.types.js';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;

interface WindowsKeyboardBindings {
  readonly sendInput: (count: number, inputs: readonly unknown[], size: number) => number;
  readonly getLastError: () => number;
  readonly inputSize: number;
}

const require = createRequire(import.meta.url);
let cachedBindings: WindowsKeyboardBindings | undefined;

export class WindowsKeyboardAdapter implements RemoteKeyboardAdapter {
  public keyDown(key: NativeKeyboardKey): void {
    this.sendKeyboardInput(key, false);
  }

  public keyUp(key: NativeKeyboardKey): void {
    this.sendKeyboardInput(key, true);
  }

  private sendKeyboardInput(key: NativeKeyboardKey, keyUp: boolean): void {
    const bindings = getWindowsBindings();
    const input = {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: key.virtualKey,
          wScan: 0,
          dwFlags: (key.extended ? KEYEVENTF_EXTENDEDKEY : 0) | (keyUp ? KEYEVENTF_KEYUP : 0),
          time: 0,
          dwExtraInfo: 0,
        },
      },
    };
    if (bindings.sendInput(1, [input], bindings.inputSize) !== 1) {
      throw new Error(`SendInput falhou no Windows (código ${bindings.getLastError()})`);
    }
  }
}

function getWindowsBindings(): WindowsKeyboardBindings {
  if (cachedBindings !== undefined) {
    return cachedBindings;
  }
  const koffi = require('koffi') as typeof Koffi;
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const mouseInputType = koffi.struct('ProfessorConnectKeyboardAdapterMouseInput', {
    dx: 'long',
    dy: 'long',
    mouseData: 'uint32_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const keyboardInputType = koffi.struct('ProfessorConnectKeyboardAdapterKeyboardInput', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const hardwareInputType = koffi.struct('ProfessorConnectKeyboardAdapterHardwareInput', {
    uMsg: 'uint32_t',
    wParamL: 'uint16_t',
    wParamH: 'uint16_t',
  });
  const inputUnionType = koffi.union('ProfessorConnectKeyboardAdapterInputUnion', {
    mi: mouseInputType,
    ki: keyboardInputType,
    hi: hardwareInputType,
  });
  const inputType = koffi.struct('ProfessorConnectKeyboardAdapterInput', {
    type: 'uint32_t',
    u: inputUnionType,
  });
  cachedBindings = {
    sendInput: user32.func(
      'unsigned int __stdcall SendInput(unsigned int cInputs, ProfessorConnectKeyboardAdapterInput *pInputs, int cbSize)',
    ) as (count: number, inputs: readonly unknown[], size: number) => number,
    getLastError: kernel32.func('unsigned long __stdcall GetLastError(void)') as () => number,
    inputSize: koffi.sizeof(inputType),
  };
  return cachedBindings;
}
