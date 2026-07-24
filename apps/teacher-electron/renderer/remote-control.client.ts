import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
} from '../shared/remote-control-contracts.js';

export interface RemoteControlTransport {
  sendMouse(event: RemoteControlMouseEvent): Promise<void>;
  sendKeyboard(event: RemoteControlKeyboardEvent): Promise<void>;
}

interface RenderedVideoBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export class RemoteControlClient {
  private active = false;
  private animationFrame: number | undefined;
  private pendingMouseMove: RemoteControlMouseEvent | undefined;
  private readonly pressedButtons = new Set<number>();

  public constructor(
    private readonly pointerTarget: HTMLVideoElement,
    private readonly transport: RemoteControlTransport,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly onSafetyStop: () => Promise<void> = async () => undefined,
  ) {}

  public start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.pointerTarget.addEventListener('mousemove', this.handleMouseMove);
    this.pointerTarget.addEventListener('mousedown', this.handleMouseButton);
    this.pointerTarget.addEventListener('mouseup', this.handleMouseButton);
    this.pointerTarget.addEventListener('dblclick', this.handleDoubleClick);
    this.pointerTarget.addEventListener('wheel', this.handleWheel, { passive: false });
    this.pointerTarget.addEventListener('contextmenu', this.preventContextMenu);
    window.addEventListener('mouseup', this.handleWindowMouseUp);
    window.addEventListener('keydown', this.handleKeyboardEvent, true);
    window.addEventListener('keyup', this.handleKeyboardEvent, true);
    window.addEventListener('keypress', this.handleKeyboardEvent, true);
    window.addEventListener('blur', this.handleFocusLost);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.pointerTarget.removeEventListener('mousemove', this.handleMouseMove);
    this.pointerTarget.removeEventListener('mousedown', this.handleMouseButton);
    this.pointerTarget.removeEventListener('mouseup', this.handleMouseButton);
    this.pointerTarget.removeEventListener('dblclick', this.handleDoubleClick);
    this.pointerTarget.removeEventListener('wheel', this.handleWheel);
    this.pointerTarget.removeEventListener('contextmenu', this.preventContextMenu);
    window.removeEventListener('mouseup', this.handleWindowMouseUp);
    window.removeEventListener('keydown', this.handleKeyboardEvent, true);
    window.removeEventListener('keyup', this.handleKeyboardEvent, true);
    window.removeEventListener('keypress', this.handleKeyboardEvent, true);
    window.removeEventListener('blur', this.handleFocusLost);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.pendingMouseMove = undefined;
    this.pressedButtons.clear();
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const serialized = this.serializeMouseEvent(event, 'mousemove');
    if (serialized === undefined) {
      return;
    }
    this.pendingMouseMove = serialized;
    if (this.animationFrame !== undefined) {
      return;
    }
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = undefined;
      const pending = this.pendingMouseMove;
      this.pendingMouseMove = undefined;
      if (pending !== undefined && this.active) {
        this.sendMouse(pending);
      }
    });
  };

  private readonly handleMouseButton = (event: MouseEvent): void => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    const type = event.type === 'mousedown' ? 'mousedown' : 'mouseup';
    const serialized = this.serializeMouseEvent(event, type);
    if (serialized === undefined) {
      return;
    }
    event.preventDefault();
    if (type === 'mousedown') {
      this.pressedButtons.add(event.button);
    } else {
      this.pressedButtons.delete(event.button);
    }
    this.sendMouse(serialized);
  };

  private readonly handleWindowMouseUp = (event: MouseEvent): void => {
    if (!this.pressedButtons.has(event.button) || event.target === this.pointerTarget) {
      return;
    }
    this.pressedButtons.delete(event.button);
    const serialized = this.serializeMouseEvent(event, 'mouseup', true);
    if (serialized !== undefined) {
      this.sendMouse(serialized);
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const serialized = this.serializeMouseEvent(event, 'dblclick');
    if (serialized !== undefined) {
      event.preventDefault();
      this.sendMouse(serialized);
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    const pointer = this.serializeMouseEvent(event, 'wheel');
    if (pointer === undefined) {
      return;
    }
    event.preventDefault();
    this.sendMouse({
      ...pointer,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    });
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handleKeyboardEvent = (event: KeyboardEvent): void => {
    if (!this.active || event.isComposing || !isSupportedKeyboardCode(event.code)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sendKeyboard({
      type: event.type === 'keydown' ? 'keydown' : event.type === 'keyup' ? 'keyup' : 'keypress',
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
  };

  private readonly handleFocusLost = (): void => {
    this.requestSafetyStop();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.requestSafetyStop();
    }
  };

  private requestSafetyStop(): void {
    if (!this.active) {
      return;
    }
    this.stop();
    void this.onSafetyStop().catch(this.onError);
  }

  private serializeMouseEvent(
    event: MouseEvent,
    type: RemoteControlMouseEvent['type'],
    clampOutside = false,
  ): RemoteControlMouseEvent | undefined {
    const bounds = getRenderedVideoBounds(this.pointerTarget);
    const rawX = (event.clientX - bounds.left) / bounds.width;
    const rawY = (event.clientY - bounds.top) / bounds.height;
    if (!clampOutside && (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1)) {
      return undefined;
    }
    return {
      type,
      x: clamp(rawX, 0, 1),
      y: clamp(rawY, 0, 1),
      button: clamp(Math.trunc(event.button), 0, 4),
      buttons: clamp(Math.trunc(event.buttons), 0, 31),
    };
  }

  private sendMouse(event: RemoteControlMouseEvent): void {
    void this.transport.sendMouse(event).catch(this.onError);
  }

  private sendKeyboard(event: RemoteControlKeyboardEvent): void {
    void this.transport.sendKeyboard(event).catch(this.onError);
  }
}

export function getRenderedVideoBounds(video: HTMLVideoElement): RenderedVideoBounds {
  const element = video.getBoundingClientRect();
  const elementWidth = Math.max(element.width, 1);
  const elementHeight = Math.max(element.height, 1);
  const videoWidth = Math.max(video.videoWidth, 1);
  const videoHeight = Math.max(video.videoHeight, 1);
  const objectFit = getComputedStyle(video).objectFit;

  if (objectFit === 'fill' || objectFit === 'none') {
    return {
      left: element.left,
      top: element.top,
      width: elementWidth,
      height: elementHeight,
    };
  }

  const scale =
    objectFit === 'cover'
      ? Math.max(elementWidth / videoWidth, elementHeight / videoHeight)
      : Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
  const width = Math.max(videoWidth * scale, 1);
  const height = Math.max(videoHeight * scale, 1);
  return {
    left: element.left + (elementWidth - width) / 2,
    top: element.top + (elementHeight - height) / 2,
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isSupportedKeyboardCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^Numpad[0-9]$/.test(code) ||
    SUPPORTED_NAMED_KEY_CODES.has(code)
  );
}

const SUPPORTED_NAMED_KEY_CODES = new Set([
  'Space',
  'Backspace',
  'Delete',
  'Tab',
  'Enter',
  'NumpadEnter',
  'Escape',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);
