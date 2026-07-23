import type {
  CameraState,
  DeviceStatus,
  MicrophoneState,
  ScreenShareState,
} from './device-status.js';

export interface MediaInputDevice {
  readonly deviceId: string;
  readonly kind: MediaDeviceKind;
  readonly label: string;
}

export interface MediaDevicesAdapter {
  enumerateDevices(): Promise<readonly MediaInputDevice[]>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  getDisplayMedia?(constraints?: DisplayMediaStreamOptions): Promise<MediaStream>;
  addEventListener?(type: 'devicechange', listener: () => void): void;
  removeEventListener?(type: 'devicechange', listener: () => void): void;
}

export interface MediaDeviceLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface MediaDeviceSnapshot {
  readonly camera: DeviceStatus<CameraState>;
  readonly microphone: DeviceStatus<MicrophoneState>;
  readonly screenShare: DeviceStatus<ScreenShareState>;
  readonly cameras: readonly MediaInputDevice[];
  readonly microphones: readonly MediaInputDevice[];
  readonly scanError?: string;
}

export type MediaDeviceListener = (snapshot: MediaDeviceSnapshot) => void;

export interface MediaDeviceManagerOptions {
  readonly mediaDevices?: MediaDevicesAdapter;
  readonly logger?: MediaDeviceLogger;
}

export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
  );
}
