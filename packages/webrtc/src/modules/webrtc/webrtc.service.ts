import {
  EventType,
  PeerNegotiationState,
  WebRtcNegotiationState,
  type DataChannelPayload,
  type SignalAnswerPayload,
  type SignalIceCandidatePayload,
  type SignalOfferPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';

import { WEBRTC_EVENTS } from './webrtc.events.js';
import { DEFAULT_DATA_CHANNEL_LABEL } from './data-channel.service.js';
import type { DataChannelService } from './data-channel.service.js';
import { PEER_EVENTS } from './peer.events.js';
import type {
  DataChannelManagerPort,
  DataChannelEventListener,
  DataChannelMessageListener,
  DataChannelPeerPort,
  DataChannelSocketMessage,
  PeerFactoryPort,
  PeerNegotiation,
} from './peer.types.js';
import type {
  MediaServicePort,
  PeerConnectionFactoryPort,
  PeerConnectionPort,
  RemoteMediaListener,
  WebRtcIceCandidate,
  WebRtcLogger,
  WebRtcManagerPort,
  WebRtcMessageIdFactory,
  WebRtcSignalingPort,
} from './webrtc.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class WebRtcService {
  private readonly pendingLocalCandidates = new Map<string, WebRtcIceCandidate[]>();
  private readonly signalingReadyCalls = new Set<string>();
  private readonly pendingConnectedCalls = new Set<string>();
  private readonly remoteMediaListeners = new Set<RemoteMediaListener>();

  public constructor(
    private readonly manager: WebRtcManagerPort,
    private readonly peerConnectionFactory: PeerConnectionFactoryPort,
    private readonly mediaService: MediaServicePort,
    private readonly signaling: WebRtcSignalingPort,
    private readonly logger: WebRtcLogger = silentLogger,
    private readonly messageIdFactory: WebRtcMessageIdFactory = () =>
      globalThis.crypto.randomUUID(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async createOffer(callId: string, sessionId: string): Promise<void> {
    await this.runNegotiation(callId, async () => {
      const negotiation = await this.createNegotiation(callId, sessionId);
      const offer = await negotiation.peer.createOffer();

      await negotiation.peer.setLocalDescription(offer);
      this.manager.transition(callId, WebRtcNegotiationState.OFFER_SENT);
      await this.signaling.sendOffer(
        this.createMessage(WEBRTC_EVENTS.offer, { callId, sdp: offer.sdp }, sessionId),
      );
      this.logger.info('Offer enviada', { callId, sessionId });
      await this.enableCandidateDelivery(callId, sessionId);
    });
  }

  public async receiveOffer(message: SocketMessage<SignalOfferPayload>): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_OFFER);
    const { callId, sdp } = message.payload;

    this.logger.info('Offer recebida', { callId, sessionId });
    await this.runNegotiation(callId, async () => {
      const negotiation = await this.createNegotiation(callId, sessionId);

      this.manager.transition(callId, WebRtcNegotiationState.OFFER_RECEIVED);
      await negotiation.peer.setRemoteDescription({ type: 'offer', sdp });

      const answer = await negotiation.peer.createAnswer();

      await negotiation.peer.setLocalDescription(answer);
      this.manager.transition(callId, WebRtcNegotiationState.ANSWER_SENT);
      await this.signaling.sendAnswer(
        this.createMessage(WEBRTC_EVENTS.answer, { callId, sdp: answer.sdp }, sessionId),
      );
      this.logger.info('Answer enviada', { callId, sessionId });
      this.enterIceExchange(callId);
      await this.enableCandidateDelivery(callId, sessionId);
    });
  }

  public async receiveAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_ANSWER);
    const { callId, sdp } = message.payload;

    this.logger.info('Answer recebida', { callId, sessionId });
    await this.runNegotiation(callId, async () => {
      const negotiation = this.requireMatchingNegotiation(callId, sessionId);

      await negotiation.peer.setRemoteDescription({ type: 'answer', sdp });
      this.manager.transition(callId, WebRtcNegotiationState.ANSWER_RECEIVED);
      this.enterIceExchange(callId);
    });
  }

  public async receiveIceCandidate(
    message: SocketMessage<SignalIceCandidatePayload>,
  ): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_ICE_CANDIDATE);
    const { callId, candidate, sdpMid, sdpMLineIndex, usernameFragment } = message.payload;

    await this.runNegotiation(callId, async () => {
      const negotiation = this.requireMatchingNegotiation(callId, sessionId);

      await negotiation.peer.addIceCandidate({
        candidate,
        ...(sdpMid === undefined ? {} : { sdpMid }),
        ...(sdpMLineIndex === undefined ? {} : { sdpMLineIndex }),
        ...(usernameFragment === undefined ? {} : { usernameFragment }),
      });
      this.logger.info('ICE Candidate recebido', { callId, sessionId });
      this.enterIceExchange(callId);
    });
  }

  public async close(callId: string): Promise<void> {
    this.signalingReadyCalls.delete(callId);
    this.pendingLocalCandidates.delete(callId);
    this.pendingConnectedCalls.delete(callId);
    const negotiation = this.manager.findNegotiation(callId);

    if (
      negotiation !== undefined &&
      this.manager.getState(callId) !== WebRtcNegotiationState.CLOSED
    ) {
      this.mediaService.detachTracks(negotiation.peer, negotiation.localStream);
    }
    await this.manager.close(callId);
  }

  public onRemoteMedia(listener: RemoteMediaListener): () => void {
    this.remoteMediaListeners.add(listener);

    return () => this.remoteMediaListeners.delete(listener);
  }

  private async createNegotiation(callId: string, sessionId: string) {
    if (callId.trim().length === 0 || sessionId.trim().length === 0) {
      throw new Error('callId e sessionId são obrigatórios');
    }

    if (this.manager.findNegotiation(callId) !== undefined) {
      throw new Error(`Negociação WebRTC já existe: ${callId}`);
    }

    const localStream = await this.mediaService.openAudioVideo();
    let peer: PeerConnectionPort | undefined;

    try {
      peer = this.peerConnectionFactory.createPeer();
      this.mediaService.attachTracks(peer, localStream);

      const negotiation = this.manager.createNegotiation({
        callId,
        sessionId,
        peer,
        localStream,
      });

      this.configurePeer(negotiation.peer, callId, sessionId);

      return negotiation;
    } catch (error) {
      await peer?.close();
      this.mediaService.close(localStream);
      throw error;
    }
  }

  private configurePeer(peer: PeerConnectionPort, callId: string, sessionId: string): void {
    peer.setIceCandidateHandler((candidate) => {
      if (candidate !== null) {
        void this.handleLocalCandidate(callId, sessionId, candidate).catch((error: unknown) => {
          this.handleAsyncFailure(callId, error);
        });
      }
    });
    peer.setRemoteTrackHandler((stream) => {
      for (const listener of this.remoteMediaListeners) {
        listener(callId, stream);
      }
    });
    peer.setConnectionStateHandler((state) => {
      if (state === 'connected') {
        this.markConnected(callId);
      } else if (state === 'failed') {
        this.manager.fail(callId);
        this.logger.error('Falha de negociação', new Error(`Peer falhou: ${callId}`));
      }
    });
  }

  private async handleLocalCandidate(
    callId: string,
    sessionId: string,
    candidate: WebRtcIceCandidate,
  ): Promise<void> {
    if (!this.signalingReadyCalls.has(callId)) {
      const candidates = this.pendingLocalCandidates.get(callId) ?? [];

      candidates.push(candidate);
      this.pendingLocalCandidates.set(callId, candidates);
      return;
    }

    await this.sendIceCandidate(callId, sessionId, candidate);
  }

  private async enableCandidateDelivery(callId: string, sessionId: string): Promise<void> {
    this.signalingReadyCalls.add(callId);
    const candidates = this.pendingLocalCandidates.get(callId) ?? [];

    this.pendingLocalCandidates.delete(callId);
    for (const candidate of candidates) {
      await this.sendIceCandidate(callId, sessionId, candidate);
    }
  }

  private async sendIceCandidate(
    callId: string,
    sessionId: string,
    candidate: WebRtcIceCandidate,
  ): Promise<void> {
    await this.signaling.sendIceCandidate(
      this.createMessage(
        WEBRTC_EVENTS.iceCandidate,
        {
          callId,
          candidate: candidate.candidate,
          ...(candidate.sdpMid === undefined ? {} : { sdpMid: candidate.sdpMid }),
          ...(candidate.sdpMLineIndex === undefined
            ? {}
            : { sdpMLineIndex: candidate.sdpMLineIndex }),
          ...(candidate.usernameFragment === undefined
            ? {}
            : { usernameFragment: candidate.usernameFragment }),
        },
        sessionId,
      ),
    );
    this.logger.info('ICE Candidate enviado', { callId, sessionId });
  }

  private enterIceExchange(callId: string): void {
    const state = this.manager.getState(callId);

    if (
      state === WebRtcNegotiationState.ANSWER_SENT ||
      state === WebRtcNegotiationState.ANSWER_RECEIVED
    ) {
      this.manager.transition(callId, WebRtcNegotiationState.ICE_EXCHANGING);
    }

    if (this.pendingConnectedCalls.delete(callId)) {
      this.markConnected(callId);
    }
  }

  private markConnected(callId: string): void {
    const state = this.manager.getState(callId);

    if (state === WebRtcNegotiationState.CONNECTED) {
      return;
    }

    if (state !== WebRtcNegotiationState.ICE_EXCHANGING) {
      this.pendingConnectedCalls.add(callId);
      return;
    }

    this.manager.transition(callId, WebRtcNegotiationState.CONNECTED);
    this.logger.info('Peer conectado', { callId });
  }

  private requireMatchingNegotiation(callId: string, sessionId: string) {
    const negotiation = this.manager.requireNegotiation(callId);

    if (negotiation.sessionId !== sessionId) {
      throw new Error(`Session não corresponde à negociação WebRTC: ${sessionId}`);
    }

    return negotiation;
  }

  private requireMessage<T>(message: SocketMessage<T>, event: EventType): string {
    if (message.event !== event) {
      throw new Error(`Evento inválido no envelope: esperado ${event}`);
    }

    if (message.id.trim().length === 0 || Number.isNaN(Date.parse(message.timestamp))) {
      throw new Error(`Envelope inválido para o evento ${event}`);
    }

    if (message.sessionId === undefined || message.sessionId.trim().length === 0) {
      throw new Error(`O evento ${event} exige sessionId`);
    }

    return message.sessionId;
  }

  private createMessage<T>(event: EventType, payload: T, sessionId: string): SocketMessage<T> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      sessionId,
      payload,
    };
  }

  private async runNegotiation(callId: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (this.manager.findNegotiation(callId) !== undefined) {
        this.manager.fail(callId);
      }
      this.logger.error('Falha de negociação', error);
      throw error;
    }
  }

  private handleAsyncFailure(callId: string, error: unknown): void {
    if (this.manager.findNegotiation(callId) !== undefined) {
      this.manager.fail(callId);
    }
    this.logger.error('Falha de negociação', error);
  }
}

export class DataChannelWebRtcService {
  private readonly pendingLocalCandidates = new Map<string, WebRtcIceCandidate[]>();
  private readonly signalingReadyCalls = new Set<string>();
  private readonly connectedPeers = new Set<string>();
  private readonly closingCalls = new Set<string>();

  public constructor(
    private readonly manager: DataChannelManagerPort,
    private readonly peerFactory: PeerFactoryPort,
    private readonly dataChannelService: DataChannelService,
    private readonly signaling: WebRtcSignalingPort,
    private readonly logger: WebRtcLogger = silentLogger,
    private readonly messageIdFactory: WebRtcMessageIdFactory = () =>
      globalThis.crypto.randomUUID(),
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.dataChannelService.onOpen((callId) => this.markConnectedIfReady(callId));
    this.dataChannelService.onClose((callId) => this.handleUnexpectedChannelClose(callId));
    this.dataChannelService.onError((callId, error) => this.handleAsyncFailure(callId, error));
  }

  public async createOffer(callId: string, sessionId: string): Promise<void> {
    await this.runNegotiation(callId, async () => {
      const negotiation = this.createNegotiation(callId, sessionId);
      const channel = negotiation.peer.createDataChannel(DEFAULT_DATA_CHANNEL_LABEL);

      this.dataChannelService.attach(callId, sessionId, channel);
      this.manager.transition(callId, PeerNegotiationState.NEGOTIATING);
      const offer = await negotiation.peer.createOffer();

      await negotiation.peer.setLocalDescription(offer);
      await this.signaling.sendOffer(
        this.createMessage(PEER_EVENTS.offer, { callId, sdp: offer.sdp }, sessionId),
      );
      this.logger.info('Offer enviada', { callId, sessionId });
      await this.enableCandidateDelivery(callId, sessionId);
      this.markConnectedIfReady(callId);
    });
  }

  public async receiveOffer(message: SocketMessage<SignalOfferPayload>): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_OFFER);
    const { callId, sdp } = message.payload;

    this.logger.info('Offer recebida', { callId, sessionId });
    await this.runNegotiation(callId, async () => {
      const negotiation = this.createNegotiation(callId, sessionId);

      this.manager.transition(callId, PeerNegotiationState.NEGOTIATING);
      await negotiation.peer.setRemoteDescription({ type: 'offer', sdp });
      const answer = await negotiation.peer.createAnswer();

      await negotiation.peer.setLocalDescription(answer);
      await this.signaling.sendAnswer(
        this.createMessage(PEER_EVENTS.answer, { callId, sdp: answer.sdp }, sessionId),
      );
      this.logger.info('Answer enviada', { callId, sessionId });
      await this.enableCandidateDelivery(callId, sessionId);
      this.markConnectedIfReady(callId);
    });
  }

  public async receiveAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_ANSWER);
    const { callId, sdp } = message.payload;

    this.logger.info('Answer recebida', { callId, sessionId });
    await this.runNegotiation(callId, async () => {
      const negotiation = this.requireMatchingNegotiation(callId, sessionId);

      await negotiation.peer.setRemoteDescription({ type: 'answer', sdp });
      this.markConnectedIfReady(callId);
    });
  }

  public async receiveIceCandidate(
    message: SocketMessage<SignalIceCandidatePayload>,
  ): Promise<void> {
    const sessionId = this.requireMessage(message, EventType.SIGNAL_ICE_CANDIDATE);
    const { callId, candidate, sdpMid, sdpMLineIndex, usernameFragment } = message.payload;

    await this.runNegotiation(callId, async () => {
      const negotiation = this.requireMatchingNegotiation(callId, sessionId);

      await negotiation.peer.addIceCandidate({
        candidate,
        ...(sdpMid === undefined ? {} : { sdpMid }),
        ...(sdpMLineIndex === undefined ? {} : { sdpMLineIndex }),
        ...(usernameFragment === undefined ? {} : { usernameFragment }),
      });
      this.logger.info('ICE Candidate recebido', { callId, sessionId });
    });
  }

  public send(callId: string, payload: DataChannelPayload): DataChannelSocketMessage {
    return this.dataChannelService.send(callId, payload);
  }

  public sendEvent<TPayload>(
    callId: string,
    event: EventType,
    payload: TPayload,
  ): SocketMessage<TPayload> {
    return this.dataChannelService.sendEvent(callId, event, payload);
  }

  public isOpen(callId: string): boolean {
    return this.dataChannelService.isOpen(callId);
  }

  public onMessage(listener: DataChannelMessageListener): () => void {
    return this.dataChannelService.onMessage(listener);
  }

  public onEvent(listener: DataChannelEventListener): () => void {
    return this.dataChannelService.onEvent(listener);
  }

  public async close(callId: string): Promise<void> {
    this.closingCalls.add(callId);
    this.signalingReadyCalls.delete(callId);
    this.pendingLocalCandidates.delete(callId);
    this.connectedPeers.delete(callId);
    this.dataChannelService.close(callId);

    try {
      await this.manager.close(callId);
    } finally {
      this.closingCalls.delete(callId);
    }
  }

  private createNegotiation(callId: string, sessionId: string): PeerNegotiation {
    this.requireIdentifiers(callId, sessionId);

    if (this.manager.findNegotiation(callId) !== undefined) {
      throw new Error(`Negociação WebRTC já existe: ${callId}`);
    }

    const peer = this.peerFactory.createPeer();

    try {
      const negotiation = this.manager.createNegotiation({ callId, sessionId, peer });

      this.manager.transition(callId, PeerNegotiationState.CONNECTING);
      this.configurePeer(peer, callId, sessionId);
      return negotiation;
    } catch (error) {
      peer.close();
      throw error;
    }
  }

  private configurePeer(peer: DataChannelPeerPort, callId: string, sessionId: string): void {
    peer.setIceCandidateHandler((candidate) => {
      if (candidate !== null) {
        void this.handleLocalCandidate(callId, sessionId, candidate).catch((error: unknown) => {
          this.handleAsyncFailure(callId, error);
        });
      }
    });
    peer.setConnectionStateHandler((state) => {
      if (state === 'connected') {
        this.connectedPeers.add(callId);
        this.markConnectedIfReady(callId);
      } else if (state === 'failed') {
        this.handleAsyncFailure(callId, new Error(`Peer falhou: ${callId}`));
      }
    });
    peer.setDataChannelHandler((channel) => {
      try {
        this.dataChannelService.attach(callId, sessionId, channel);
        this.markConnectedIfReady(callId);
      } catch (error) {
        this.handleAsyncFailure(callId, error);
      }
    });
  }

  private async handleLocalCandidate(
    callId: string,
    sessionId: string,
    candidate: WebRtcIceCandidate,
  ): Promise<void> {
    if (!this.signalingReadyCalls.has(callId)) {
      const candidates = this.pendingLocalCandidates.get(callId) ?? [];

      candidates.push(candidate);
      this.pendingLocalCandidates.set(callId, candidates);
      return;
    }

    await this.sendIceCandidate(callId, sessionId, candidate);
  }

  private async enableCandidateDelivery(callId: string, sessionId: string): Promise<void> {
    this.signalingReadyCalls.add(callId);
    const candidates = this.pendingLocalCandidates.get(callId) ?? [];

    this.pendingLocalCandidates.delete(callId);
    for (const candidate of candidates) {
      await this.sendIceCandidate(callId, sessionId, candidate);
    }
  }

  private async sendIceCandidate(
    callId: string,
    sessionId: string,
    candidate: WebRtcIceCandidate,
  ): Promise<void> {
    const payload: SignalIceCandidatePayload = {
      callId,
      candidate: candidate.candidate,
      ...(candidate.sdpMid === undefined ? {} : { sdpMid: candidate.sdpMid }),
      ...(candidate.sdpMLineIndex === undefined ? {} : { sdpMLineIndex: candidate.sdpMLineIndex }),
      ...(candidate.usernameFragment === undefined
        ? {}
        : { usernameFragment: candidate.usernameFragment }),
    };

    await this.signaling.sendIceCandidate(
      this.createMessage(PEER_EVENTS.iceCandidate, payload, sessionId),
    );
    this.logger.info('ICE Candidate enviado', { callId, sessionId });
  }

  private markConnectedIfReady(callId: string): void {
    const negotiation = this.manager.findNegotiation(callId);

    if (
      negotiation === undefined ||
      this.manager.getState(callId) !== PeerNegotiationState.NEGOTIATING ||
      !this.connectedPeers.has(callId) ||
      !this.dataChannelService.isOpen(callId)
    ) {
      return;
    }

    this.manager.transition(callId, PeerNegotiationState.CONNECTED);
    this.logger.info('Peer conectado', { callId });
  }

  private handleUnexpectedChannelClose(callId: string): void {
    const negotiation = this.manager.findNegotiation(callId);

    if (
      negotiation !== undefined &&
      !this.closingCalls.has(callId) &&
      this.manager.getState(callId) !== PeerNegotiationState.CLOSED
    ) {
      this.handleAsyncFailure(callId, new Error(`DataChannel fechado inesperadamente: ${callId}`));
    }
  }

  private requireMatchingNegotiation(callId: string, sessionId: string): PeerNegotiation {
    const negotiation = this.manager.requireNegotiation(callId);

    if (negotiation.sessionId !== sessionId) {
      throw new Error(`Session não corresponde à negociação WebRTC: ${sessionId}`);
    }

    return negotiation;
  }

  private requireIdentifiers(callId: string, sessionId: string): void {
    if (callId.trim().length === 0 || sessionId.trim().length === 0) {
      throw new Error('callId e sessionId são obrigatórios');
    }
  }

  private requireMessage<T>(message: SocketMessage<T>, event: EventType): string {
    if (message.event !== event) {
      throw new Error(`Evento inválido no envelope: esperado ${event}`);
    }

    if (message.id.trim().length === 0 || Number.isNaN(Date.parse(message.timestamp))) {
      throw new Error(`Envelope inválido para o evento ${event}`);
    }

    if (message.sessionId === undefined || message.sessionId.trim().length === 0) {
      throw new Error(`O evento ${event} exige sessionId`);
    }

    return message.sessionId;
  }

  private createMessage<T>(event: EventType, payload: T, sessionId: string): SocketMessage<T> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      sessionId,
      payload,
    };
  }

  private async runNegotiation(callId: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (this.manager.findNegotiation(callId) !== undefined) {
        this.manager.fail(callId);
      }
      this.logger.error('Erro', error);
      throw error;
    }
  }

  private handleAsyncFailure(callId: string, error: unknown): void {
    if (this.manager.findNegotiation(callId) !== undefined) {
      this.manager.fail(callId);
    }
    this.logger.error('Erro', error);
  }
}
