import { BrowserMediaStream } from '../../../modules/webrtc/media.service.js';
import type {
  MediaStreamPort,
  PeerConnectionPort,
  WebRtcLogger,
} from '../../../modules/webrtc/webrtc.types.js';
import type {
  RtcMediaDevice,
  RtcMediaDevicesPort,
  RtcMediaManagerPort,
  RtcMediaRendererPort,
  RtcMediaSettings,
} from './rtc-types.js';

export const DEFAULT_RTC_MEDIA_SETTINGS: RtcMediaSettings = Object.freeze({
  audio: Object.freeze({}),
  video: Object.freeze({}),
});

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class BrowserRtcMediaDevices implements RtcMediaDevicesPort {
  public async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamPort> {
    const mediaDevices = requireMediaDevices();
    return new BrowserMediaStream(await mediaDevices.getUserMedia(constraints));
  }

  public async enumerateDevices(): Promise<readonly RtcMediaDevice[]> {
    const devices = await requireMediaDevices().enumerateDevices();

    return devices.filter(isSupportedDevice).map((device) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: device.label,
    }));
  }
}

export class BrowserVideoRenderer implements RtcMediaRendererPort {
  public constructor(
    private readonly element: HTMLVideoElement,
    muted = false,
  ) {
    this.element.autoplay = true;
    this.element.playsInline = true;
    this.element.muted = muted;
  }

  public async attach(stream: MediaStreamPort): Promise<void> {
    if (!(stream.source instanceof MediaStream)) {
      throw new Error('MediaStream incompatível com o renderizador de vídeo nativo');
    }

    this.element.srcObject = stream.source;
    await this.element.play();
  }

  public clear(): void {
    this.element.pause();
    this.element.srcObject = null;
  }
}

export class MediaManager implements RtcMediaManagerPort {
  private settings: RtcMediaSettings = DEFAULT_RTC_MEDIA_SETTINGS;
  private localStream: MediaStreamPort | undefined;

  public constructor(
    private readonly mediaDevices: RtcMediaDevicesPort = new BrowserRtcMediaDevices(),
    private readonly logger: WebRtcLogger = silentLogger,
  ) {}

  public configure(settings: RtcMediaSettings): void {
    validateSettings(settings);
    this.settings = settings;
  }

  public async listDevices(): Promise<readonly RtcMediaDevice[]> {
    return this.mediaDevices.enumerateDevices();
  }

  public async openAudioVideo(): Promise<MediaStreamPort> {
    try {
      const stream = await this.mediaDevices.getUserMedia(createConstraints(this.settings));

      this.requireAudioVideo(stream);
      this.localStream = stream;
      this.logger.info('Permissão concedida');
      this.logger.info('Câmera iniciada');
      this.logger.info('Microfone iniciado');
      this.logger.info('Stream local criada');
      return stream;
    } catch (error) {
      if (isPermissionError(error)) {
        this.logger.error('Permissão negada', error);
      } else {
        this.logger.error('Falhas', error);
      }
      throw error;
    }
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

    if (this.localStream?.source === stream.source) {
      this.localStream = undefined;
    }
  }

  public getLocalStream(): MediaStreamPort | undefined {
    return this.localStream;
  }

  public async renderLocal(renderer: RtcMediaRendererPort): Promise<void> {
    const stream = this.localStream;

    if (stream === undefined) {
      throw new Error('Stream local ainda não foi criada');
    }

    await this.renderStream(stream, renderer);
  }

  public async renderStream(
    stream: MediaStreamPort,
    renderer: RtcMediaRendererPort,
  ): Promise<void> {
    await renderer.attach(stream);
  }

  public async renderRemote(
    stream: MediaStreamPort,
    renderer: RtcMediaRendererPort,
  ): Promise<void> {
    await this.renderStream(stream, renderer);
    this.logger.info('Stream remota recebida');
  }

  private requireAudioVideo(stream: MediaStreamPort): void {
    if (stream.getAudioTracks().length === 0) {
      this.close(stream);
      throw new Error('Nenhuma faixa de áudio foi capturada');
    }

    if (stream.getVideoTracks().length === 0) {
      this.close(stream);
      throw new Error('Nenhuma faixa de vídeo foi capturada');
    }
  }
}

function requireMediaDevices(): MediaDevices {
  if (globalThis.navigator?.mediaDevices === undefined) {
    throw new Error('MediaDevices não está disponível neste ambiente');
  }

  return globalThis.navigator.mediaDevices;
}

function isSupportedDevice(device: MediaDeviceInfo): device is MediaDeviceInfo & RtcMediaDevice {
  return (
    device.kind === 'audioinput' || device.kind === 'audiooutput' || device.kind === 'videoinput'
  );
}

function createConstraints(settings: RtcMediaSettings): MediaStreamConstraints {
  return {
    audio:
      settings.audio.deviceId === undefined
        ? true
        : { deviceId: { exact: settings.audio.deviceId } },
    video: {
      ...(settings.video.deviceId === undefined
        ? {}
        : { deviceId: { exact: settings.video.deviceId } }),
      ...(settings.video.width === undefined ? {} : { width: { ideal: settings.video.width } }),
      ...(settings.video.height === undefined ? {} : { height: { ideal: settings.video.height } }),
      ...(settings.video.frameRate === undefined
        ? {}
        : { frameRate: { ideal: settings.video.frameRate } }),
    },
  };
}

function validateSettings(settings: RtcMediaSettings): void {
  const values = [settings.video.width, settings.video.height, settings.video.frameRate];

  if (values.some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))) {
    throw new Error('Resolução e FPS devem ser números positivos');
  }
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
  );
}
