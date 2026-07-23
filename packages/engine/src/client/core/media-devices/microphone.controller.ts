import { MICROPHONE_STATUS, MicrophoneState, type DeviceStatus } from './device-status.js';
import {
  isPermissionDenied,
  type MediaDeviceLogger,
  type MediaDevicesAdapter,
} from './media-device.types.js';

export class MicrophoneController {
  private status: DeviceStatus<MicrophoneState> = MICROPHONE_STATUS[MicrophoneState.NOT_FOUND];
  private stream: MediaStream | undefined;
  private available = false;

  public constructor(
    private readonly mediaDevices: MediaDevicesAdapter,
    private readonly logger: MediaDeviceLogger,
    private readonly notify: () => void,
  ) {}

  public getStatus(): DeviceStatus<MicrophoneState> {
    return this.status;
  }

  public getStream(): MediaStream | undefined {
    return this.stream;
  }

  public updateAvailability(available: boolean): void {
    const wasAvailable = this.available;
    this.available = available;
    if (!available) {
      this.releaseStream();
      this.setStatus(MicrophoneState.NOT_FOUND);
      if (wasAvailable) {
        this.logger.info('Microfone desconectado');
      }
      return;
    }
    if (this.status.state === MicrophoneState.NOT_FOUND) {
      this.setStatus(MicrophoneState.MUTED);
      this.logger.info('Microfone detectado');
    }
  }

  public setDetectionError(): void {
    this.available = false;
    this.releaseStream();
    this.setStatus(MicrophoneState.ERROR);
    this.logger.error('Erro ao detectar o microfone');
  }

  public async start(): Promise<MediaStream | undefined> {
    if (this.stream !== undefined) {
      return this.stream;
    }
    if (!this.available) {
      this.setStatus(MicrophoneState.NOT_FOUND);
      return undefined;
    }

    try {
      const stream = await this.mediaDevices.getUserMedia({ video: false, audio: true });
      const track = stream.getAudioTracks()[0];
      if (track === undefined) {
        stopStream(stream);
        this.setStatus(MicrophoneState.ERROR);
        this.logger.error('Erro ao acessar o microfone');
        return undefined;
      }
      this.stream = stream;
      track.addEventListener?.('ended', this.handleEnded, { once: true });
      this.setStatus(MicrophoneState.ACTIVE);
      this.logger.info('Microfone iniciado');
      return stream;
    } catch (error) {
      if (isPermissionDenied(error)) {
        this.setStatus(MicrophoneState.PERMISSION_DENIED);
        this.logger.error('Permissão para microfone negada', error);
      } else {
        this.setStatus(MicrophoneState.ERROR);
        this.logger.error('Erro ao acessar o microfone', error);
      }
      return undefined;
    }
  }

  public mute(): MediaStream | undefined {
    const stream = this.stream;
    this.releaseStream();
    this.setStatus(this.available ? MicrophoneState.MUTED : MicrophoneState.NOT_FOUND);
    if (stream !== undefined) {
      this.logger.info('Microfone mutado');
    }
    return stream;
  }

  public dispose(): void {
    this.releaseStream();
  }

  private readonly handleEnded = (): void => {
    this.stream = undefined;
    this.setStatus(this.available ? MicrophoneState.MUTED : MicrophoneState.NOT_FOUND);
    this.logger.info('Microfone desconectado');
  };

  private releaseStream(): void {
    if (this.stream !== undefined) {
      for (const track of this.stream.getAudioTracks()) {
        track.removeEventListener?.('ended', this.handleEnded);
      }
      stopStream(this.stream);
      this.stream = undefined;
    }
  }

  private setStatus(state: MicrophoneState): void {
    if (this.status.state === state) {
      return;
    }
    this.status = MICROPHONE_STATUS[state];
    this.notify();
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
