import { StateMachine, type StateTransition } from '@professor-connect/services/state-machine';

import type { WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import { REMOTE_CONTROL_STATE_TRANSITIONS } from './remote.events.js';
import {
  RemoteControlState,
  type PermissionExpiredListener,
  type PermissionManagerOptions,
  type PermissionManagerPort,
  type PermissionScheduler,
  type PermissionTimerHandle,
  type RemoteControlContext,
  type RemoteControlStateListener,
} from './remote.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

const defaultScheduler: PermissionScheduler = {
  schedule(action, delayMs): PermissionTimerHandle {
    return setTimeout(action, delayMs);
  },
  cancel(handle): void {
    clearTimeout(handle);
  },
};

export class PermissionManager implements PermissionManagerPort {
  private readonly stateMachine: StateMachine<RemoteControlState>;
  private readonly expiredListeners = new Set<PermissionExpiredListener>();
  private readonly logger: WebRtcLogger;
  private readonly clock: () => Date;
  private readonly scheduler: PermissionScheduler;
  private context: RemoteControlContext | undefined;
  private expirationTimer: PermissionTimerHandle | undefined;

  public constructor(options: PermissionManagerOptions = {}) {
    this.logger = options.logger ?? silentLogger;
    this.clock = options.clock ?? (() => new Date());
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.stateMachine = new StateMachine(
      RemoteControlState.IDLE,
      REMOTE_CONTROL_STATE_TRANSITIONS,
      {
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        logger: this.logger,
        context: { component: 'remote-control-permission' },
      },
    );
  }

  public request(context: RemoteControlContext): void {
    validateContext(context);
    this.clearExpiration();
    this.stateMachine.transitionTo(RemoteControlState.REQUESTED);
    this.context = context;
  }

  public authorize(expiresAt: string): void {
    const context = this.requireContext();
    const expiresAtMs = Date.parse(expiresAt);
    const delayMs = expiresAtMs - this.clock().getTime();

    if (Number.isNaN(expiresAtMs) || delayMs <= 0) {
      throw new Error('A autorização deve possuir uma expiração futura válida');
    }

    this.stateMachine.transitionTo(RemoteControlState.AUTHORIZED);
    this.context = { ...context, expiresAt };
    this.expirationTimer = this.scheduler.schedule(() => this.expire(), delayMs);
  }

  public deny(): void {
    this.requireContext();
    this.clearExpiration();
    this.stateMachine.transitionTo(RemoteControlState.DENIED);
  }

  public activate(): void {
    this.requireAuthorized();
    this.stateMachine.transitionTo(RemoteControlState.ACTIVE);
  }

  public stop(): void {
    this.requireContext();
    const state = this.getState();

    if (state === RemoteControlState.STOPPED) {
      return;
    }
    if (state !== RemoteControlState.AUTHORIZED && state !== RemoteControlState.ACTIVE) {
      throw new Error(`Não é possível encerrar o controle remoto no estado ${state}`);
    }

    this.clearExpiration();
    this.stateMachine.transitionTo(RemoteControlState.STOPPING);
    this.stateMachine.transitionTo(RemoteControlState.STOPPED);
  }

  public revoke(): void {
    this.stop();
  }

  public expireRemote(): void {
    if (this.getState() === RemoteControlState.EXPIRED) {
      return;
    }
    this.requireContext();
    this.clearExpiration();
    this.stateMachine.transitionTo(RemoteControlState.EXPIRED);
  }

  public fail(): void {
    if (this.getState() === RemoteControlState.FAILED) {
      return;
    }
    this.requireContext();
    this.clearExpiration();
    this.stateMachine.transitionTo(RemoteControlState.FAILED);
  }

  public isAuthorized(): boolean {
    const context = this.context;
    const state = this.getState();

    return (
      context?.expiresAt !== undefined &&
      Date.parse(context.expiresAt) > this.clock().getTime() &&
      (state === RemoteControlState.AUTHORIZED || state === RemoteControlState.ACTIVE)
    );
  }

  public getContext(): RemoteControlContext | undefined {
    return this.context;
  }

  public getState(): RemoteControlState {
    return this.stateMachine.getCurrentState();
  }

  public getStateHistory(): readonly StateTransition<RemoteControlState>[] {
    return this.stateMachine.getHistory();
  }

  public onStateChanged(listener: RemoteControlStateListener): () => void {
    return this.stateMachine.onTransition(listener);
  }

  public onExpired(listener: PermissionExpiredListener): () => void {
    this.expiredListeners.add(listener);
    return () => this.expiredListeners.delete(listener);
  }

  private expire(): void {
    const context = this.requireContext();
    const state = this.getState();

    this.expirationTimer = undefined;
    if (state !== RemoteControlState.AUTHORIZED && state !== RemoteControlState.ACTIVE) {
      return;
    }

    this.stateMachine.transitionTo(RemoteControlState.EXPIRED);
    this.logger.info('Permissão expirada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
    for (const listener of this.expiredListeners) {
      listener(context);
    }
  }

  private requireAuthorized(): void {
    if (!this.isAuthorized()) {
      throw new Error('Autorização de controle remoto ausente ou expirada');
    }
  }

  private requireContext(): RemoteControlContext {
    if (this.context === undefined) {
      throw new Error('Solicitação de controle remoto não encontrada');
    }

    return this.context;
  }

  private clearExpiration(): void {
    if (this.expirationTimer !== undefined) {
      this.scheduler.cancel(this.expirationTimer);
      this.expirationTimer = undefined;
    }
  }
}

function validateContext(context: RemoteControlContext): void {
  if (
    context.callId.trim().length === 0 ||
    context.sessionId.trim().length === 0 ||
    context.authorizationId.trim().length === 0 ||
    !Number.isInteger(context.durationMs) ||
    context.durationMs <= 0
  ) {
    throw new Error('callId, sessionId, authorizationId e durationMs válidos são obrigatórios');
  }
}
