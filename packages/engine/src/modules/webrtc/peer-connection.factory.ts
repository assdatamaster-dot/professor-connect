import { BrowserMediaStream, BrowserMediaTrack } from './media.service.js';
import type {
  IceCandidateHandler,
  MediaStreamPort,
  MediaTrackPort,
  PeerConnectionFactoryPort,
  PeerConnectionPort,
  PeerConnectionStateHandler,
  RemoteTrackHandler,
  WebRtcIceCandidate,
  WebRtcPeerConnectionState,
  WebRtcSessionDescription,
} from './webrtc.types.js';
import {
  DEFAULT_WEBRTC_ICE_SETTINGS,
  createRtcConfiguration,
  type WebRtcIceSettings,
} from '../../config/webrtc.js';

export {
  DEFAULT_WEBRTC_ICE_SETTINGS,
  createRtcConfiguration,
  loadWebRtcIceSettings,
  type TurnServerSettings,
  type WebRtcEnvironment,
  type WebRtcIceSettings,
} from '../../config/webrtc.js';

export type PeerConnectionCreator = (configuration: RTCConfiguration) => PeerConnectionPort;

export class PeerConnectionFactory implements PeerConnectionFactoryPort {
  private readonly rtcConfiguration: RTCConfiguration;

  public constructor(
    settings: WebRtcIceSettings = DEFAULT_WEBRTC_ICE_SETTINGS,
    private readonly creator: PeerConnectionCreator = createBrowserPeer,
  ) {
    this.rtcConfiguration = createRtcConfiguration(settings);
  }

  public createPeer(): PeerConnectionPort {
    return this.creator(this.rtcConfiguration);
  }
}

class BrowserPeerConnection implements PeerConnectionPort {
  private readonly sendersByTrack = new Map<unknown, RTCRtpSender>();

  public constructor(private readonly peer: RTCPeerConnection) {}

  public get connectionState(): WebRtcPeerConnectionState {
    return this.peer.connectionState;
  }

  public addTrack(track: MediaTrackPort, stream: MediaStreamPort): void {
    if (!(track instanceof BrowserMediaTrack) || !(stream instanceof BrowserMediaStream)) {
      throw new Error('Faixa ou stream incompatível com RTCPeerConnection nativo');
    }

    const sender = this.peer.addTrack(track.source, stream.source);

    this.sendersByTrack.set(track.source, sender);
  }

  public removeTrack(track: MediaTrackPort): void {
    const sender = this.sendersByTrack.get(track.source);

    if (sender !== undefined) {
      this.peer.removeTrack(sender);
      this.sendersByTrack.delete(track.source);
    }
  }

  public async replaceTrack(
    currentTrack: MediaTrackPort,
    replacementTrack: MediaTrackPort,
  ): Promise<void> {
    if (!(replacementTrack instanceof BrowserMediaTrack)) {
      throw new Error('Faixa incompatível com RTCRtpSender nativo');
    }

    const sender = this.sendersByTrack.get(currentTrack.source);

    if (sender === undefined) {
      throw new Error('Sender da faixa de vídeo não encontrado');
    }

    await sender.replaceTrack(replacementTrack.source);
    this.sendersByTrack.delete(currentTrack.source);
    this.sendersByTrack.set(replacementTrack.source, sender);
  }

  public restartIce(): void {
    this.peer.restartIce();
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

  public setRemoteTrackHandler(handler: RemoteTrackHandler): void {
    this.peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);

      handler(new BrowserMediaStream(stream), new BrowserMediaTrack(event.track));
    };
  }

  public setConnectionStateHandler(handler: PeerConnectionStateHandler): void {
    this.peer.onconnectionstatechange = () => {
      handler(this.peer.connectionState);
    };
  }

  public close(): void {
    this.sendersByTrack.clear();
    this.peer.close();
  }
}

function createBrowserPeer(configuration: RTCConfiguration): PeerConnectionPort {
  if (globalThis.RTCPeerConnection === undefined) {
    throw new Error('RTCPeerConnection não está disponível neste ambiente');
  }

  return new BrowserPeerConnection(new globalThis.RTCPeerConnection(configuration));
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
