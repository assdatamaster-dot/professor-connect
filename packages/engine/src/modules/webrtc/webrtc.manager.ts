import { StateMachine, type StateTransition } from '@professor-connect/services/state-machine';
import {
  PeerNegotiationState,
  WebRtcNegotiationState,
  type PeerNegotiationStatePayload,
  type SocketMessage,
  type WebRtcNegotiationStatePayload,
} from '@professor-connect/protocol';

import { WEBRTC_EVENTS, WEBRTC_STATE_TRANSITIONS } from './webrtc.events.js';
import { PEER_EVENTS, PEER_STATE_TRANSITIONS } from './peer.events.js';
import type { DataChannelManagerPort, PeerNegotiation, PeerStateListener } from './peer.types.js';
import type {
  WebRtcLogger,
  WebRtcManagerOptions,
  WebRtcManagerPort,
  WebRtcNegotiation,
  WebRtcStateListener,
} from './webrtc.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class WebRtcManager implements WebRtcManagerPort {
  private readonly negotiations = new Map<string, WebRtcNegotiation>();
  private readonly stateMachines = new Map<string, StateMachine<WebRtcNegotiationState>>();
  private readonly stateListeners = new Set<WebRtcStateListener>();
  private readonly clock: () => Date;
  private readonly messageIdFactory: () => string;
  private readonly logger: WebRtcLogger;

  public constructor(options: WebRtcManagerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.messageIdFactory = options.messageIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.logger = options.logger ?? silentLogger;
  }

  public createNegotiation(negotiation: WebRtcNegotiation): WebRtcNegotiation {
    if (this.negotiations.has(negotiation.callId)) {
      throw new Error(`Negociação WebRTC já existe: ${negotiation.callId}`);
    }

    const stateMachine = new StateMachine(WebRtcNegotiationState.NEW, WEBRTC_STATE_TRANSITIONS, {
      clock: this.clock,
      logger: this.logger,
      context: { callId: negotiation.callId },
    });

    stateMachine.onTransition((transition) => {
      this.emitStateChanged(negotiation, transition);
    });
    this.negotiations.set(negotiation.callId, negotiation);
    this.stateMachines.set(negotiation.callId, stateMachine);
    this.logger.info('Peer criado', {
      callId: negotiation.callId,
      sessionId: negotiation.sessionId,
    });

    return negotiation;
  }

  public findNegotiation(callId: string): WebRtcNegotiation | undefined {
    return this.negotiations.get(callId);
  }

  public requireNegotiation(callId: string): WebRtcNegotiation {
    const negotiation = this.findNegotiation(callId);

    if (negotiation === undefined) {
      throw new Error(`Negociação WebRTC não encontrada: ${callId}`);
    }

    return negotiation;
  }

  public getState(callId: string): WebRtcNegotiationState {
    return this.requireStateMachine(callId).getCurrentState();
  }

  public getStateHistory(callId: string): readonly StateTransition<WebRtcNegotiationState>[] {
    return this.requireStateMachine(callId).getHistory();
  }

  public transition(callId: string, state: WebRtcNegotiationState): void {
    this.requireStateMachine(callId).transitionTo(state);
  }

  public fail(callId: string): void {
    const state = this.getState(callId);

    if (state !== WebRtcNegotiationState.FAILED && state !== WebRtcNegotiationState.CLOSED) {
      this.transition(callId, WebRtcNegotiationState.FAILED);
    }
  }

  public async close(callId: string): Promise<void> {
    const negotiation = this.requireNegotiation(callId);
    const state = this.getState(callId);

    if (state === WebRtcNegotiationState.CLOSED) {
      return;
    }

    for (const track of negotiation.localStream.getTracks()) {
      track.stop();
    }
    await negotiation.peer.close();
    this.transition(callId, WebRtcNegotiationState.CLOSED);
    this.logger.info('Peer encerrado', { callId });
  }

  public onStateChanged(listener: WebRtcStateListener): () => void {
    this.stateListeners.add(listener);

    return () => this.stateListeners.delete(listener);
  }

  private requireStateMachine(callId: string): StateMachine<WebRtcNegotiationState> {
    const stateMachine = this.stateMachines.get(callId);

    if (stateMachine === undefined) {
      throw new Error(`State Machine WebRTC não encontrada: ${callId}`);
    }

    return stateMachine;
  }

  private emitStateChanged(
    negotiation: WebRtcNegotiation,
    transition: StateTransition<WebRtcNegotiationState>,
  ): void {
    const message: SocketMessage<WebRtcNegotiationStatePayload> = {
      id: this.messageIdFactory(),
      event: WEBRTC_EVENTS.stateChanged,
      timestamp: transition.timestamp,
      sessionId: negotiation.sessionId,
      payload: {
        callId: negotiation.callId,
        previousState: transition.previousState,
        state: transition.nextState,
      },
    };

    for (const listener of this.stateListeners) {
      listener(message);
    }
  }
}

export class DataChannelWebRtcManager implements DataChannelManagerPort {
  private readonly negotiations = new Map<string, PeerNegotiation>();
  private readonly stateMachines = new Map<string, StateMachine<PeerNegotiationState>>();
  private readonly stateListeners = new Set<PeerStateListener>();
  private readonly clock: () => Date;
  private readonly messageIdFactory: () => string;
  private readonly logger: WebRtcLogger;

  public constructor(options: WebRtcManagerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.messageIdFactory = options.messageIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.logger = options.logger ?? silentLogger;
  }

  public createNegotiation(negotiation: PeerNegotiation): PeerNegotiation {
    if (this.negotiations.has(negotiation.callId)) {
      throw new Error(`Negociação WebRTC já existe: ${negotiation.callId}`);
    }

    const stateMachine = new StateMachine(PeerNegotiationState.NEW, PEER_STATE_TRANSITIONS, {
      clock: this.clock,
      logger: this.logger,
      context: { callId: negotiation.callId },
    });

    stateMachine.onTransition((transition) => this.emitStateChanged(negotiation, transition));
    this.negotiations.set(negotiation.callId, negotiation);
    this.stateMachines.set(negotiation.callId, stateMachine);
    this.logger.info('Peer criado', {
      callId: negotiation.callId,
      sessionId: negotiation.sessionId,
    });

    return negotiation;
  }

  public findNegotiation(callId: string): PeerNegotiation | undefined {
    return this.negotiations.get(callId);
  }

  public requireNegotiation(callId: string): PeerNegotiation {
    const negotiation = this.findNegotiation(callId);

    if (negotiation === undefined) {
      throw new Error(`Negociação WebRTC não encontrada: ${callId}`);
    }

    return negotiation;
  }

  public getState(callId: string): PeerNegotiationState {
    return this.requireStateMachine(callId).getCurrentState();
  }

  public getStateHistory(callId: string): readonly StateTransition<PeerNegotiationState>[] {
    return this.requireStateMachine(callId).getHistory();
  }

  public transition(callId: string, state: PeerNegotiationState): void {
    this.requireStateMachine(callId).transitionTo(state);
  }

  public fail(callId: string): void {
    const state = this.getState(callId);

    if (state !== PeerNegotiationState.FAILED && state !== PeerNegotiationState.CLOSED) {
      this.transition(callId, PeerNegotiationState.FAILED);
    }
  }

  public async close(callId: string): Promise<void> {
    const negotiation = this.requireNegotiation(callId);

    if (this.getState(callId) === PeerNegotiationState.CLOSED) {
      return;
    }

    await negotiation.peer.close();
    this.transition(callId, PeerNegotiationState.CLOSED);
    this.logger.info('Peer fechado', { callId });
  }

  public onStateChanged(listener: PeerStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private requireStateMachine(callId: string): StateMachine<PeerNegotiationState> {
    const stateMachine = this.stateMachines.get(callId);

    if (stateMachine === undefined) {
      throw new Error(`State Machine WebRTC não encontrada: ${callId}`);
    }

    return stateMachine;
  }

  private emitStateChanged(
    negotiation: PeerNegotiation,
    transition: StateTransition<PeerNegotiationState>,
  ): void {
    const message: SocketMessage<PeerNegotiationStatePayload> = {
      id: this.messageIdFactory(),
      event: PEER_EVENTS.stateChanged,
      timestamp: transition.timestamp,
      sessionId: negotiation.sessionId,
      payload: {
        callId: negotiation.callId,
        previousState: transition.previousState,
        state: transition.nextState,
      },
    };

    for (const listener of this.stateListeners) {
      listener(message);
    }
  }
}
