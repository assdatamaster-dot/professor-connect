import koffi from 'koffi';

import type { RemoteMouseAdapter, RemoteMouseButton } from './remote-mouse.types.js';

const INPUT_MOUSE = 0;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const mouseInputType = koffi.struct('ProfessorConnectMouseInput', {
  dx: 'long',
  dy: 'long',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const keyboardInputType = koffi.struct('ProfessorConnectKeyboardInput', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const hardwareInputType = koffi.struct('ProfessorConnectHardwareInput', {
  uMsg: 'uint32_t',
  wParamL: 'uint16_t',
  wParamH: 'uint16_t',
});
const inputUnionType = koffi.union('ProfessorConnectInputUnion', {
  mi: mouseInputType,
  ki: keyboardInputType,
  hi: hardwareInputType,
});
const inputType = koffi.struct('ProfessorConnectInput', {
  type: 'uint32_t',
  u: inputUnionType,
});

const setCursorPosition = user32.func('int __stdcall SetCursorPos(int x, int y)') as (
  x: number,
  y: number,
) => number;
const sendInput = user32.func(
  'unsigned int __stdcall SendInput(unsigned int cInputs, ProfessorConnectInput *pInputs, int cbSize)',
) as (count: number, inputs: readonly unknown[], size: number) => number;
const getLastError = kernel32.func('unsigned long __stdcall GetLastError(void)') as () => number;

export class WindowsMouseAdapter implements RemoteMouseAdapter {
  public moveTo(x: number, y: number): void {
    if (setCursorPosition(x, y) === 0) {
      throw createWindowsError('SetCursorPos');
    }
  }

  public buttonDown(button: RemoteMouseButton): void {
    this.sendMouseInput(button === 'left' ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_RIGHTDOWN);
  }

  public buttonUp(button: RemoteMouseButton): void {
    this.sendMouseInput(button === 'left' ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_RIGHTUP);
  }

  public scroll(horizontalDelta: number, verticalDelta: number): void {
    if (verticalDelta !== 0) {
      this.sendMouseInput(MOUSEEVENTF_WHEEL, verticalDelta);
    }
    if (horizontalDelta !== 0) {
      this.sendMouseInput(MOUSEEVENTF_HWHEEL, horizontalDelta);
    }
  }

  private sendMouseInput(flags: number, mouseData = 0): void {
    const input = {
      type: INPUT_MOUSE,
      u: {
        mi: {
          dx: 0,
          dy: 0,
          mouseData: mouseData >>> 0,
          dwFlags: flags,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    };
    if (sendInput(1, [input], koffi.sizeof(inputType)) !== 1) {
      throw createWindowsError('SendInput');
    }
  }
}

function createWindowsError(operation: string): Error {
  return new Error(`${operation} falhou no Windows (código ${getLastError()})`);
}
