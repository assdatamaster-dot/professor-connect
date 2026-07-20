import type {
  MediaDevicesPort,
  MediaKind,
  MediaServicePort,
  MediaStreamPort,
  MediaTrackPort,
  PeerConnectionPort,
} from './webrtc.types.js';

export class BrowserMediaTrack implements MediaTrackPort {
  public readonly kind: MediaKind;
  public readonly source: MediaStreamTrack;

  public constructor(track: MediaStreamTrack) {
    if (track.kind !== 'audio' && track.kind !== 'video') {
      throw new Error(`Tipo de mídia não suportado: ${track.kind}`);
    }

    this.kind = track.kind;
    this.source = track;
  }

  public stop(): void {
    this.source.stop();
  }

  public setEndedHandler(handler: () => void): void {
    this.source.onended = handler;
  }
}

export class BrowserMediaStream implements MediaStreamPort {
  public readonly source: MediaStream;

  public constructor(stream: MediaStream) {
    this.source = stream;
  }

  public getTracks(): readonly MediaTrackPort[] {
    return this.source.getTracks().map((track) => new BrowserMediaTrack(track));
  }

  public getAudioTracks(): readonly MediaTrackPort[] {
    return this.source.getAudioTracks().map((track) => new BrowserMediaTrack(track));
  }

  public getVideoTracks(): readonly MediaTrackPort[] {
    return this.source.getVideoTracks().map((track) => new BrowserMediaTrack(track));
  }
}

class BrowserMediaDevices implements MediaDevicesPort {
  public async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort> {
    if (globalThis.navigator?.mediaDevices === undefined) {
      throw new Error('MediaDevices não está disponível neste ambiente');
    }

    return new BrowserMediaStream(
      await globalThis.navigator.mediaDevices.getUserMedia(constraints),
    );
  }
}

export class MediaService implements MediaServicePort {
  public constructor(private readonly mediaDevices: MediaDevicesPort = new BrowserMediaDevices()) {}

  public async openAudioVideo(): Promise<MediaStreamPort> {
    const stream = await this.mediaDevices.getUserMedia({ audio: true, video: true });

    if (stream.getAudioTracks().length === 0) {
      this.close(stream);
      throw new Error('Nenhuma faixa de áudio foi capturada');
    }

    if (stream.getVideoTracks().length === 0) {
      this.close(stream);
      throw new Error('Nenhuma faixa de vídeo foi capturada');
    }

    return stream;
  }

  public attachTracks(peer: PeerConnectionPort, stream: MediaStreamPort): void {
    for (const track of stream.getTracks()) {
      peer.addTrack(track, stream);
    }
  }

  public detachTracks(peer: PeerConnectionPort, stream: MediaStreamPort): void {
    for (const track of stream.getTracks()) {
      peer.removeTrack(track);
    }
  }

  public close(stream: MediaStreamPort): void {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
