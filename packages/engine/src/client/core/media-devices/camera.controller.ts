import { CAMERA_STATUS, CameraState, type DeviceStatus } from './device-status.js';
import {
  isPermissionDenied,
  type MediaDeviceLogger,
  type MediaDevicesAdapter,
} from './media-device.types.js';

export class CameraController {
  private status: DeviceStatus<CameraState> = CAMERA_STATUS[CameraState.NOT_FOUND];
  private stream: MediaStream | undefined;
  private available = false;

  public constructor(
    private readonly mediaDevices: MediaDevicesAdapter,
    private readonly logger: MediaDeviceLogger,
    private readonly notify: () => void,
  ) {}

  public getStatus(): DeviceStatus<CameraState> {
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
      this.setStatus(CameraState.NOT_FOUND);
      if (wasAvailable) {
        this.logger.info('Câmera desconectada');
      }
      return;
    }
    if (this.status.state === CameraState.NOT_FOUND) {
      this.setStatus(CameraState.AVAILABLE);
      this.logger.info('Câmera detectada');
    }
  }

  public setDetectionError(): void {
    this.available = false;
    this.releaseStream();
    this.setStatus(CameraState.ERROR);
    this.logger.error('Erro ao detectar a câmera');
  }

  public async start(): Promise<MediaStream | undefined> {
    if (this.stream !== undefined) {
      return this.stream;
    }
    if (!this.available) {
      this.setStatus(CameraState.NOT_FOUND);
      return undefined;
    }

    try {
      const stream = await this.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (track === undefined) {
        stopStream(stream);
        this.setStatus(CameraState.ERROR);
        this.logger.error('Erro ao acessar a câmera');
        return undefined;
      }
      this.stream = stream;
      track.addEventListener?.('ended', this.handleEnded, { once: true });
      this.setStatus(CameraState.ACTIVE);
      this.logger.info('Câmera iniciada');
      return stream;
    } catch (error) {
      if (isPermissionDenied(error)) {
        this.setStatus(CameraState.PERMISSION_DENIED);
        this.logger.error('Permissão para câmera negada', error);
      } else {
        this.setStatus(CameraState.ERROR);
        this.logger.error('Erro ao acessar a câmera', error);
      }
      return undefined;
    }
  }

  public stop(): MediaStream | undefined {
    const stream = this.stream;
    this.releaseStream();
    this.setStatus(this.available ? CameraState.DISABLED : CameraState.NOT_FOUND);
    if (stream !== undefined) {
      this.logger.info('Câmera desligada');
    }
    return stream;
  }

  public dispose(): void {
    this.releaseStream();
  }

  private readonly handleEnded = (): void => {
    this.stream = undefined;
    this.setStatus(this.available ? CameraState.DISABLED : CameraState.NOT_FOUND);
    this.logger.info('Câmera desconectada');
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

  private setStatus(state: CameraState): void {
    if (this.status.state === state) {
      return;
    }
    this.status = CAMERA_STATUS[state];
    this.notify();
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
