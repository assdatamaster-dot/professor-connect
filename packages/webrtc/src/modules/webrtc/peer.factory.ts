import { createRtcConfiguration, type WebRtcIceSettings } from '../../config/webrtc.js';
import type {
  DataChannelCloseHandler,
  DataChannelErrorHandler,
  DataChannelMessageHandler,
  DataChannelOpenHandler,
  DataChannelPeerPort,
  DataChannelPort,
  PeerFactoryPort,
  RemoteDataChannelHandler,
} from './peer.types.js';
import type {
  IceCandidateHandler,
  PeerConnectionStateHandler,
  WebRtcIceCandidate,
  WebRtcSessionDescription,
} from './webrtc.types.js';

export type NativePeerCreator = (configuration: RTCConfiguration) => RTCPeerConnection;

export class PeerFactory implements PeerFactoryPort {
  private readonly configuration: RTCConfiguration;

  public constructor(
    settings: WebRtcIceSettings,
    private readonly creator: NativePeerCreator = createNativePeer,
  ) {
    this.configuration = createRtcConfiguration(settings);
  }

  public createPeer(): DataChannelPeerPort {
    return new BrowserDataChannelPeer(this.creator(this.configuration));
  }
}

class BrowserDataChannelPeer implements DataChannelPeerPort {
  public constructor(private readonly peer: RTCPeerConnection) {}

  public get connectionState(): RTCPeerConnectionState {
    return this.peer.connectionState;
  }

  public createDataChannel(label: string): DataChannelPort {
    return new BrowserDataChannel(this.peer.createDataChannel(label));
  }

  public async createOffer(): Promise<WebRtcSessionDescription> {
    return requireDescription(await this.peer.createOffer(), 'offer');
  }

  public async createAnswer(): Promise<WebRtcSessionDescription> {
    return requireDescription(await this.peer.createAnswer(), 'answer');
  }

  public async setLocalDescription(description: WebRtcSessionDescription): Promise<void> {
    await this.peer.setLocalDescription(description);
  }

  public async setRemoteDescription(description: WebRtcSessionDescription): Promise<void> {
    await this.peer.setRemoteDescription(description);
  }

  public async addIceCandidate(candidate: WebRtcIceCandidate): Promise<void> {
    await this.peer.addIceCandidate(candidate);
  }

  public setIceCandidateHandler(handler: IceCandidateHandler): void {
    this.peer.onicecandidate = (event) => {
      handler(event.candidate === null ? null : toIceCandidate(event.candidate));
    };
  }

  public setConnectionStateHandler(handler: PeerConnectionStateHandler): void {
    this.peer.onconnectionstatechange = () => handler(this.peer.connectionState);
  }

  public setDataChannelHandler(handler: RemoteDataChannelHandler): void {
    this.peer.ondatachannel = (event) => handler(new BrowserDataChannel(event.channel));
  }

  public close(): void {
    this.peer.close();
  }
}

class BrowserDataChannel implements DataChannelPort {
  public constructor(private readonly channel: RTCDataChannel) {}

  public get label(): string {
    return this.channel.label;
  }

  public get readyState(): RTCDataChannelState {
    return this.channel.readyState;
  }

  public send(data: string): void {
    this.channel.send(data);
  }

  public close(): void {
    this.channel.close();
  }

  public setOpenHandler(handler: DataChannelOpenHandler): void {
    this.channel.onopen = handler;
  }

  public setCloseHandler(handler: DataChannelCloseHandler): void {
    this.channel.onclose = handler;
  }

  public setErrorHandler(handler: DataChannelErrorHandler): void {
    this.channel.onerror = (event) => handler(event);
  }

  public setMessageHandler(handler: DataChannelMessageHandler): void {
    this.channel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        handler('');
        return;
      }

      handler(event.data);
    };
  }
}

function createNativePeer(configuration: RTCConfiguration): RTCPeerConnection {
  if (globalThis.RTCPeerConnection === undefined) {
    throw new Error('RTCPeerConnection não está disponível neste ambiente');
  }

  return new globalThis.RTCPeerConnection(configuration);
}

function requireDescription(
  description: RTCSessionDescriptionInit,
  type: 'offer' | 'answer',
): WebRtcSessionDescription {
  if (description.sdp === undefined || description.sdp.length === 0) {
    throw new Error(`SDP ${type} não foi gerado`);
  }

  return { type, sdp: description.sdp };
}

function toIceCandidate(candidate: RTCIceCandidate): WebRtcIceCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}
