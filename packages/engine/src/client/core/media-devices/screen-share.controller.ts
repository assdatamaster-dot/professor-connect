import { SCREEN_SHARE_STATUS, ScreenShareState, type DeviceStatus } from './device-status.js';
import {
  isPermissionDenied,
  type MediaDeviceLogger,
  type MediaDevicesAdapter,
} from './media-device.types.js';

export class ScreenShareController {
  private status: DeviceStatus<ScreenShareState> = SCREEN_SHARE_STATUS[ScreenShareState.IDLE];
  private stream: MediaStream | undefined;

  public constructor(
    private readonly mediaDevices: MediaDevicesAdapter,
    private readonly logger: MediaDeviceLogger,
    private readonly notify: () => void,
  ) {}

  public getStatus(): DeviceStatus<ScreenShareState> {
    return this.status;
  }

  public getStream(): MediaStream | undefined {
    return this.stream;
  }

  public async start(): Promise<MediaStream | undefined> {
    if (this.stream !== undefined) {
      return this.stream;
    }
    if (this.mediaDevices.getDisplayMedia === undefined) {
      this.setStatus(ScreenShareState.ERROR);
      this.logger.error('Compartilhamento de tela indisponível');
      return undefined;
    }

    try {
      const stream = await this.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (track === undefined) {
        stopStream(stream);
        this.setStatus(ScreenShareState.ERROR);
        this.logger.error('Erro ao compartilhar a tela');
        return undefined;
      }
      this.stream = stream;
      track.addEventListener?.('ended', this.handleEnded, { once: true });
      this.setStatus(ScreenShareState.SHARING);
      this.logger.info('Compartilhamento iniciado');
      return stream;
    } catch (error) {
      if (isPermissionDenied(error)) {
        this.setStatus(ScreenShareState.PERMISSION_DENIED);
        this.logger.error('Permissão para compartilhar a tela negada', error);
      } else {
        this.setStatus(ScreenShareState.ERROR);
        this.logger.error('Erro ao compartilhar a tela', error);
      }
      return undefined;
    }
  }

  public stop(): MediaStream | undefined {
    const stream = this.stream;
    this.releaseStream();
    this.setStatus(ScreenShareState.STOPPED);
    if (stream !== undefined) {
      this.logger.info('Compartilhamento encerrado');
    }
    return stream;
  }

  public dispose(): void {
    this.releaseStream();
  }

  private readonly handleEnded = (): void => {
    this.stream = undefined;
    this.setStatus(ScreenShareState.STOPPED);
    this.logger.info('Compartilhamento encerrado');
  };

  private releaseStream(): void {
    if (this.stream !== undefined) {
      for (const track of this.stream.getVideoTracks()) {
        track.removeEventListener?.('ended', this.handleEnded);
      }
      stopStream(this.stream);
      this.stream = undefined;
    }
  }

  private setStatus(state: ScreenShareState): void {
    if (this.status.state === state) {
      return;
    }
    this.status = SCREEN_SHARE_STATUS[state];
    this.notify();
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
