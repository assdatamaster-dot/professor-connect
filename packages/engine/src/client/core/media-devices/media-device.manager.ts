import { createStructuredLogger } from '../../../common/structured-logger.js';
import { CameraController } from './camera.controller.js';
import { MicrophoneController } from './microphone.controller.js';
import { ScreenShareController } from './screen-share.controller.js';
import type {
  MediaDeviceListener,
  MediaDeviceManagerOptions,
  MediaDeviceSnapshot,
  MediaDevicesAdapter,
  MediaInputDevice,
} from './media-device.types.js';

const browserLogger = createStructuredLogger('media-device-manager');

export class BrowserMediaDevicesAdapter implements MediaDevicesAdapter {
  public enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return requireMediaDevices().enumerateDevices();
  }

  public getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    return requireMediaDevices().getUserMedia(constraints);
  }

  public getDisplayMedia(constraints?: DisplayMediaStreamOptions): Promise<MediaStream> {
    const mediaDevices = requireMediaDevices();
    if (mediaDevices.getDisplayMedia === undefined) {
      throw new Error('Compartilhamento de tela não suportado');
    }
    return mediaDevices.getDisplayMedia(constraints);
  }

  public addEventListener(type: 'devicechange', listener: () => void): void {
    requireMediaDevices().addEventListener(type, listener);
  }

  public removeEventListener(type: 'devicechange', listener: () => void): void {
    requireMediaDevices().removeEventListener(type, listener);
  }
}

export class MediaDeviceManager {
  public readonly camera: CameraController;
  public readonly microphone: MicrophoneController;
  public readonly screenShare: ScreenShareController;

  private readonly mediaDevices: MediaDevicesAdapter;
  private readonly listeners = new Set<MediaDeviceListener>();
  private cameras: readonly MediaInputDevice[] = [];
  private microphones: readonly MediaInputDevice[] = [];
  private scanError: string | undefined;
  private initialized = false;
  private disposed = false;
  private refreshPromise: Promise<MediaDeviceSnapshot> | undefined;

  public constructor(options: MediaDeviceManagerOptions = {}) {
    this.mediaDevices = options.mediaDevices ?? new BrowserMediaDevicesAdapter();
    const logger = options.logger ?? browserLogger;
    const notify = (): void => this.emit();
    this.camera = new CameraController(this.mediaDevices, logger, notify);
    this.microphone = new MicrophoneController(this.mediaDevices, logger, notify);
    this.screenShare = new ScreenShareController(this.mediaDevices, logger, notify);
  }

  public async initialize(): Promise<MediaDeviceSnapshot> {
    if (this.disposed) {
      throw new Error('MediaDeviceManager já foi encerrado');
    }
    if (!this.initialized) {
      this.mediaDevices.addEventListener?.('devicechange', this.handleDeviceChange);
      this.initialized = true;
    }
    await this.refreshDevices();
    return this.getSnapshot();
  }

  public refreshDevices(): Promise<MediaDeviceSnapshot> {
    if (this.disposed) {
      return Promise.resolve(this.getSnapshot());
    }
    if (this.refreshPromise !== undefined) {
      return this.refreshPromise;
    }
    const refresh = this.performRefresh().finally(() => {
      if (this.refreshPromise === refresh) {
        this.refreshPromise = undefined;
      }
    });
    this.refreshPromise = refresh;
    return refresh;
  }

  private async performRefresh(): Promise<MediaDeviceSnapshot> {
    try {
      const devices = await this.mediaDevices.enumerateDevices();
      if (this.disposed) {
        return this.getSnapshot();
      }
      this.cameras = devices.filter((device) => device.kind === 'videoinput');
      this.microphones = devices.filter((device) => device.kind === 'audioinput');
      this.scanError = undefined;
      this.camera.updateAvailability(this.cameras.length > 0);
      this.microphone.updateAvailability(this.microphones.length > 0);
    } catch {
      if (this.disposed) {
        return this.getSnapshot();
      }
      this.cameras = [];
      this.microphones = [];
      this.scanError = 'Não foi possível verificar os dispositivos de mídia.';
      this.camera.setDetectionError();
      this.microphone.setDetectionError();
    }
    this.emit();
    return this.getSnapshot();
  }

  public getSnapshot(): MediaDeviceSnapshot {
    return Object.freeze({
      camera: this.camera.getStatus(),
      microphone: this.microphone.getStatus(),
      screenShare: this.screenShare.getStatus(),
      cameras: this.cameras,
      microphones: this.microphones,
      ...(this.scanError === undefined ? {} : { scanError: this.scanError }),
    });
  }

  public subscribe(listener: MediaDeviceListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.mediaDevices.removeEventListener?.('devicechange', this.handleDeviceChange);
    this.camera.dispose();
    this.microphone.dispose();
    this.screenShare.dispose();
    this.listeners.clear();
    this.initialized = false;
  }

  private readonly handleDeviceChange = (): void => {
    void this.refreshDevices();
  };

  private emit(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function requireMediaDevices(): MediaDevices {
  if (globalThis.navigator?.mediaDevices === undefined) {
    throw new Error('Dispositivos de mídia não estão disponíveis neste ambiente');
  }
  return globalThis.navigator.mediaDevices;
}
