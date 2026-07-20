import {
  WebRtcNegotiationState,
  type ScreenShareFailedPayload,
  type ScreenShareReferencePayload,
  type ScreenShareRequestPayload,
  type SignalAnswerPayload,
  type SignalIceCandidatePayload,
  type SignalOfferPayload,
  type SocketMessage,
  type WebRtcNegotiationStatePayload,
} from '@professor-connect/shared-types';

import type { MediaStreamPort, WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import { RtcEventType } from './rtc-events.js';
import type { ScreenSharingServicePort, ScreenSharingState } from './screen-sharing.types.js';
import type {
  RtcEvent,
  RtcEventListener,
  RtcMediaDevice,
  RtcMediaManagerPort,
  RtcMediaSettings,
  RtcMediaView,
  RtcPeerManagerPort,
} from './rtc-types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class RtcEngine {
  private readonly listeners = new Set<RtcEventListener>();
  private readonly remoteStreamSources = new Set<unknown>();
  private reconnecting = false;
  private screenSharingService: ScreenSharingServicePort | undefined;

  public constructor(
    private readonly peerManager: RtcPeerManagerPort,
    private readonly mediaManager: RtcMediaManagerPort,
    private readonly view: RtcMediaView,
    private readonly logger: WebRtcLogger = silentLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.peerManager.onRemoteMedia((callId, stream) => {
      void this.handleRemoteMedia(callId, stream);
    });
    this.peerManager.onStateChanged((message) => this.handleStateChanged(message));
  }

  public configureMedia(settings: RtcMediaSettings): void {
    this.mediaManager.configure(settings);
  }

  public configureScreenSharing(service: ScreenSharingServicePort): void {
    this.screenSharingService = service;
  }

  public requestScreenShare(): Promise<void> {
    const connection = this.requireConnection();
    return this.requireScreenSharingService().request(connection.callId, connection.sessionId);
  }

  public receiveScreenShareRequest(message: SocketMessage<ScreenShareRequestPayload>): void {
    this.requireScreenSharingService().receiveRequest(message);
  }

  public acceptScreenShare(): Promise<void> {
    return this.requireScreenSharingService().accept();
  }

  public receiveScreenShareAccept(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireScreenSharingService().receiveAccept(message);
  }

  public denyScreenShare(): Promise<void> {
    return this.requireScreenSharingService().deny();
  }

  public receiveScreenShareDeny(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireScreenSharingService().receiveDeny(message);
  }

  public receiveScreenShareStarted(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireScreenSharingService().receiveStarted(message);
  }

  public stopScreenShare(): Promise<void> {
    return this.requireScreenSharingService().stop();
  }

  public receiveScreenShareStopped(message: SocketMessage<ScreenShareReferencePayload>): void {
    this.requireScreenSharingService().receiveStopped(message);
  }

  public receiveScreenShareFailed(message: SocketMessage<ScreenShareFailedPayload>): void {
    this.requireScreenSharingService().receiveFailed(message);
  }

  public getScreenSharingState(): ScreenSharingState | undefined {
    return this.screenSharingService?.getState();
  }

  public listDevices(): Promise<readonly RtcMediaDevice[]> {
    return this.mediaManager.listDevices();
  }

  public async connect(callId: string, sessionId: string): Promise<void> {
    await this.run(callId, async () => {
      this.remoteStreamSources.clear();
      await this.peerManager.connect(callId, sessionId);
      await this.renderLocal(callId);
    });
  }

  public async receiveOffer(message: SocketMessage<SignalOfferPayload>): Promise<void> {
    await this.run(message.payload.callId, async () => {
      this.remoteStreamSources.clear();
      await this.view.local.clear();
      await this.view.remote.clear();
      await this.peerManager.receiveOffer(message);
      await this.renderLocal(message.payload.callId);
    });
  }

  public async receiveAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void> {
    await this.run(message.payload.callId, () => this.peerManager.receiveAnswer(message));
  }

  public async receiveIceCandidate(
    message: SocketMessage<SignalIceCandidatePayload>,
  ): Promise<void> {
    await this.run(message.payload.callId, () => this.peerManager.receiveIceCandidate(message));
  }

  public async reconnect(): Promise<void> {
    const connection = this.peerManager.getConnection();

    if (connection === undefined) {
      throw new Error('Conexão RTC ainda não foi criada');
    }

    await this.run(connection.callId, async () => {
      this.reconnecting = true;
      this.emit(RtcEventType.RECONNECTING, connection.callId);
      if (this.screenSharingService?.isLocalSharing() === true) {
        await this.screenSharingService.stop();
      }
      this.remoteStreamSources.clear();
      await this.view.local.clear();
      await this.view.remote.clear();
      await this.peerManager.reconnect();
      await this.renderLocal(connection.callId);
    });
  }

  public async close(): Promise<void> {
    const callId = this.peerManager.getConnection()?.callId;

    if (callId === undefined) {
      return;
    }

    await this.run(callId, async () => {
      if (this.screenSharingService?.isLocalSharing() === true) {
        await this.screenSharingService.stop();
      }
      await this.peerManager.close();
      await this.view.local.clear();
      await this.view.remote.clear();
      this.remoteStreamSources.clear();
      this.reconnecting = false;
      this.logger.info('Encerramento', { callId });
      this.emit(RtcEventType.CLOSED, callId);
    });
  }

  public getState(): WebRtcNegotiationState | undefined {
    return this.peerManager.getState();
  }

  public onEvent(listener: RtcEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async renderLocal(callId: string): Promise<void> {
    await this.mediaManager.renderLocal(this.view.local);
    this.emit(RtcEventType.LOCAL_STREAM_CREATED, callId);
  }

  private async handleRemoteMedia(callId: string, stream: MediaStreamPort): Promise<void> {
    if (this.remoteStreamSources.has(stream.source)) {
      return;
    }

    this.remoteStreamSources.add(stream.source);
    try {
      await this.mediaManager.renderRemote(stream, this.view.remote);
      this.emit(RtcEventType.REMOTE_STREAM_RECEIVED, callId);
    } catch (error) {
      this.handleFailure(callId, error);
    }
  }

  private handleStateChanged(message: SocketMessage<WebRtcNegotiationStatePayload>): void {
    if (message.payload.state !== WebRtcNegotiationState.CONNECTED) {
      return;
    }

    this.emit(RtcEventType.PEER_CONNECTED, message.payload.callId);
    if (this.reconnecting) {
      this.reconnecting = false;
      this.emit(RtcEventType.RECONNECTED, message.payload.callId);
    }
  }

  private emit(type: RtcEventType, callId: string, error?: unknown): void {
    const event: RtcEvent = {
      type,
      callId,
      timestamp: this.clock().toISOString(),
      ...(error === undefined ? {} : { error }),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async run(callId: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.handleFailure(callId, error);
      throw error;
    }
  }

  private handleFailure(callId: string, error: unknown): void {
    this.reconnecting = false;
    this.logger.error('Falhas', error);
    this.emit(RtcEventType.FAILED, callId, error);
  }

  private requireScreenSharingService(): ScreenSharingServicePort {
    if (this.screenSharingService === undefined) {
      throw new Error('Screen Sharing não foi configurado no RTC Engine');
    }

    return this.screenSharingService;
  }

  private requireConnection() {
    const connection = this.peerManager.getConnection();

    if (connection === undefined) {
      throw new Error('Conexão RTC ainda não foi criada');
    }

    return connection;
  }
}
