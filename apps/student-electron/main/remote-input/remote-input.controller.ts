import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
  RemoteControlRequest,
} from '@professor-connect/protocol';
import { createStructuredLogger, type StructuredLogger } from '@professor-connect/engine';

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
    private readonly logger: StructuredLogger = createStructuredLogger('remote-input'),
  ) {}

  public start(reference: RemoteControlRequest): void {
    this.permissions.grant(reference);
    try {
      this.mouseController.start(reference);
      this.keyboardController.start(reference);
    } catch (error) {
      this.permissions.revoke();
      this.stopController('keyboard-stop-after-start-failure', () =>
        this.keyboardController.stop(),
      );
      this.stopController('mouse-stop-after-start-failure', () => this.mouseController.stop());
      this.logger.error('input-start-failed', error);
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
    this.stopController('keyboard-stop-failed', () => this.keyboardController.stop());
    this.stopController('mouse-stop-failed', () => this.mouseController.stop());
  }

  public isActive(): boolean {
    return (
      this.permissions.isActive() &&
      this.mouseController.isActive() &&
      this.keyboardController.isActive()
    );
  }

  private stopController(event: string, stop: () => void): void {
    try {
      stop();
    } catch (error) {
      this.logger.error(event, error);
    }
  }
}
