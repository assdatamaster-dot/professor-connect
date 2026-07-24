import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
  RemoteControlRequest,
} from '@professor-connect/protocol';

import type {
  RemoteKeyboardControllerPort,
  RemoteKeyboardEventLog,
} from '../remote-keyboard/remote-keyboard.controller.js';
import type {
  RemoteMouseControllerPort,
  RemoteMouseEventLog,
} from '../remote-mouse/remote-mouse.controller.js';
import { InputPermissions } from './input-permissions.js';

export interface RemoteInputControllerPort {
  start(reference: RemoteControlRequest): void;
  receiveMouse(
    reference: RemoteControlRequest,
    event: RemoteControlMouseEvent,
  ): RemoteMouseEventLog;
  receiveKeyboard(
    reference: RemoteControlRequest,
    event: RemoteControlKeyboardEvent,
  ): readonly RemoteKeyboardEventLog[];
  stop(): void;
  isActive(): boolean;
}

export class RemoteInputController implements RemoteInputControllerPort {
  public constructor(
    private readonly mouseController: RemoteMouseControllerPort,
    private readonly keyboardController: RemoteKeyboardControllerPort,
    private readonly permissions = new InputPermissions(),
  ) {}

  public start(reference: RemoteControlRequest): void {
    this.permissions.grant(reference);
    try {
      this.mouseController.start(reference);
      this.keyboardController.start(reference);
    } catch (error) {
      this.mouseController.stop();
      this.keyboardController.stop();
      this.permissions.revoke();
      throw error;
    }
  }

  public receiveMouse(
    reference: RemoteControlRequest,
    event: RemoteControlMouseEvent,
  ): RemoteMouseEventLog {
    this.permissions.require(reference);
    return this.mouseController.receive(event);
  }

  public receiveKeyboard(
    reference: RemoteControlRequest,
    event: RemoteControlKeyboardEvent,
  ): readonly RemoteKeyboardEventLog[] {
    this.permissions.require(reference);
    return this.keyboardController.receive(event);
  }

  public stop(): void {
    // Revoga primeiro para impedir novos eventos enquanto as teclas/botões são liberados.
    this.permissions.revoke();
    this.keyboardController.stop();
    this.mouseController.stop();
  }

  public isActive(): boolean {
    return (
      this.permissions.isActive() &&
      this.mouseController.isActive() &&
      this.keyboardController.isActive()
    );
  }
}
