import type {
  SignalAnswerPayload,
  SignalIceCandidatePayload,
  SignalOfferPayload,
  SocketMessage,
  WebRtcNegotiationState,
} from '@professor-connect/protocol';

import { WebRtcManager } from '../../../modules/webrtc/webrtc.manager.js';
import { WebRtcService } from '../../../modules/webrtc/webrtc.service.js';
import type {
  RemoteMediaListener,
  MediaTrackPort,
  WebRtcLogger,
  WebRtcStateListener,
} from '../../../modules/webrtc/webrtc.types.js';
import type { PeerManagerDependencies, RtcConnection, RtcPeerManagerPort } from './rtc-types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

interface PeerRuntime {
  readonly manager: WebRtcManager;
  readonly service: WebRtcService;
  readonly unsubscribeRemoteMedia: () => void;
  readonly unsubscribeState: () => void;
}

export class PeerManager implements RtcPeerManagerPort {
  private readonly remoteMediaListeners = new Set<RemoteMediaListener>();
  private readonly stateListeners = new Set<WebRtcStateListener>();
  private runtime: PeerRuntime;
  private connection: RtcConnection | undefined;
  private outgoingVideoTrack: MediaTrackPort | undefined;

  public constructor(
    private readonly dependencies: PeerManagerDependencies,
    private readonly logger: WebRtcLogger = silentLogger,
  ) {
    this.runtime = this.createRuntime();
  }

  public async connect(callId: string, sessionId: string): Promise<void> {
    if (this.runtime.manager.findNegotiation(callId) !== undefined) {
      throw new Error(`Conexão RTC já existe: ${callId}`);
    }

    this.connection = { callId, sessionId };
    await this.runtime.service.createOffer(callId, sessionId);
  }

  public async receiveOffer(message: SocketMessage<SignalOfferPayload>): Promise<void> {
    const sessionId = requireSessionId(message);

    await this.replaceRuntimeIfNecessary(message.payload.callId);
    this.connection = { callId: message.payload.callId, sessionId };
    await this.runtime.service.receiveOffer(message);
  }

  public async receiveAnswer(message: SocketMessage<SignalAnswerPayload>): Promise<void> {
    await this.runtime.service.receiveAnswer(message);
  }

  public async receiveIceCandidate(
    message: SocketMessage<SignalIceCandidatePayload>,
  ): Promise<void> {
    await this.runtime.service.receiveIceCandidate(message);
  }

  public async replaceVideoTrack(track: MediaTrackPort): Promise<void> {
    const negotiation = this.requireNegotiation();
    const currentTrack = this.outgoingVideoTrack ?? this.requireCameraVideoTrack();

    await negotiation.peer.replaceTrack(currentTrack, track);
    this.outgoingVideoTrack = track;
  }

  public async restoreCameraVideoTrack(): Promise<void> {
    const currentTrack = this.outgoingVideoTrack;

    if (currentTrack === undefined) {
      return;
    }

    const cameraTrack = this.requireCameraVideoTrack();

    await this.requireNegotiation().peer.replaceTrack(currentTrack, cameraTrack);
    this.outgoingVideoTrack = undefined;
  }

  public async reconnect(): Promise<void> {
    const connection = this.requireConnection();

    await this.closeRuntime();
    this.replaceRuntime();
    this.connection = connection;
    await this.runtime.service.createOffer(connection.callId, connection.sessionId);
  }

  public async close(): Promise<void> {
    await this.closeRuntime();
    this.connection = undefined;
  }

  public getConnection(): RtcConnection | undefined {
    return this.connection;
  }

  public getState(): WebRtcNegotiationState | undefined {
    const callId = this.connection?.callId;

    if (callId === undefined || this.runtime.manager.findNegotiation(callId) === undefined) {
      return undefined;
    }

    return this.runtime.manager.getState(callId);
  }

  public onRemoteMedia(listener: RemoteMediaListener): () => void {
    this.remoteMediaListeners.add(listener);
    return () => this.remoteMediaListeners.delete(listener);
  }

  public onStateChanged(listener: WebRtcStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private createRuntime(): PeerRuntime {
    const manager = new WebRtcManager({ logger: this.logger });
    const service = new WebRtcService(
      manager,
      this.dependencies.peerFactory,
      this.dependencies.mediaManager,
      this.dependencies.signaling,
      this.logger,
    );
    const unsubscribeRemoteMedia = service.onRemoteMedia((callId, stream) => {
      for (const listener of this.remoteMediaListeners) {
        listener(callId, stream);
      }
    });
    const unsubscribeState = manager.onStateChanged((message) => {
      for (const listener of this.stateListeners) {
        listener(message);
      }
    });

    return { manager, service, unsubscribeRemoteMedia, unsubscribeState };
  }

  private async replaceRuntimeIfNecessary(callId: string): Promise<void> {
    if (this.runtime.manager.findNegotiation(callId) !== undefined) {
      await this.closeRuntime();
      this.replaceRuntime();
    }
  }

  private replaceRuntime(): void {
    this.runtime.unsubscribeRemoteMedia();
    this.runtime.unsubscribeState();
    this.runtime = this.createRuntime();
    this.outgoingVideoTrack = undefined;
  }

  private async closeRuntime(): Promise<void> {
    const callId = this.connection?.callId;

    if (callId === undefined || this.runtime.manager.findNegotiation(callId) === undefined) {
      return;
    }

    await this.runtime.service.close(callId);
  }

  private requireConnection(): RtcConnection {
    if (this.connection === undefined) {
      throw new Error('Conexão RTC ainda não foi criada');
    }

    return this.connection;
  }

  private requireNegotiation() {
    const connection = this.requireConnection();
    return this.runtime.manager.requireNegotiation(connection.callId);
  }

  private requireCameraVideoTrack(): MediaTrackPort {
    const track = this.dependencies.mediaManager.getLocalStream()?.getVideoTracks()[0];

    if (track === undefined) {
      throw new Error('Faixa de câmera local não encontrada');
    }

    return track;
  }
}

function requireSessionId<T>(message: SocketMessage<T>): string {
  if (message.sessionId === undefined || message.sessionId.trim().length === 0) {
    throw new Error('A mensagem RTC exige sessionId');
  }

  return message.sessionId;
}
