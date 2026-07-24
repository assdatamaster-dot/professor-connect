import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CameraState,
  MediaDeviceManager,
  MicrophoneState,
  ScreenShareState,
  type MediaDevicesAdapter,
  type MediaInputDevice,
} from '../src/index.js';

class FakeTrack {
  public stopped = false;
  private readonly listeners = new Set<() => void>();

  public constructor(public readonly kind: 'audio' | 'video') {}

  public stop(): void {
    this.stopped = true;
  }

  public addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.add(listener);
  }

  public removeEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.delete(listener);
  }

  public end(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public asMediaTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

class FakeStream {
  public constructor(
    private readonly audioTracks: readonly FakeTrack[],
    private readonly videoTracks: readonly FakeTrack[],
  ) {}

  public getTracks(): MediaStreamTrack[] {
    return [...this.audioTracks, ...this.videoTracks].map((track) => track.asMediaTrack());
  }

  public getAudioTracks(): MediaStreamTrack[] {
    return this.audioTracks.map((track) => track.asMediaTrack());
  }

  public getVideoTracks(): MediaStreamTrack[] {
    return this.videoTracks.map((track) => track.asMediaTrack());
  }

  public asMediaStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

class FakeMediaDevices implements MediaDevicesAdapter {
  public devices: readonly MediaInputDevice[] = [];
  public enumerateCalls = 0;
  public enumerateGate: Promise<void> | undefined;
  public cameraError: unknown;
  public microphoneError: unknown;
  public displayError: unknown;
  public enumerateError: unknown;
  public readonly cameraTrack = new FakeTrack('video');
  public readonly microphoneTrack = new FakeTrack('audio');
  public readonly screenTrack = new FakeTrack('video');
  private deviceChangeListener: (() => void) | undefined;

  public async enumerateDevices(): Promise<readonly MediaInputDevice[]> {
    this.enumerateCalls += 1;
    await this.enumerateGate;
    if (this.enumerateError !== undefined) {
      throw this.enumerateError;
    }
    return this.devices;
  }

  public async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    if (constraints.video !== false) {
      if (this.cameraError !== undefined) {
        throw this.cameraError;
      }
      return new FakeStream([], [this.cameraTrack]).asMediaStream();
    }
    if (this.microphoneError !== undefined) {
      throw this.microphoneError;
    }
    return new FakeStream([this.microphoneTrack], []).asMediaStream();
  }

  public async getDisplayMedia(): Promise<MediaStream> {
    if (this.displayError !== undefined) {
      throw this.displayError;
    }
    return new FakeStream([], [this.screenTrack]).asMediaStream();
  }

  public addEventListener(_type: 'devicechange', listener: () => void): void {
    this.deviceChangeListener = listener;
  }

  public removeEventListener(): void {
    this.deviceChangeListener = undefined;
  }

  public emitDeviceChange(): void {
    this.deviceChangeListener?.();
  }
}

const camera: MediaInputDevice = {
  deviceId: 'camera-1',
  kind: 'videoinput',
  label: 'Webcam',
};
const microphone: MediaInputDevice = {
  deviceId: 'microphone-1',
  kind: 'audioinput',
  label: 'Microfone',
};
const silentLogger = { info(): void {}, error(): void {} };

test('detecta e atualiza dispositivos conectados sem reiniciar', async () => {
  const mediaDevices = new FakeMediaDevices();
  mediaDevices.devices = [camera];
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });

  const initial = await manager.initialize();
  assert.equal(initial.camera.state, CameraState.AVAILABLE);
  assert.equal(initial.microphone.state, MicrophoneState.NOT_FOUND);

  mediaDevices.devices = [camera, microphone];
  mediaDevices.emitDeviceChange();
  await waitForMicrotask();

  assert.equal(manager.getSnapshot().microphone.state, MicrophoneState.MUTED);
  assert.equal(manager.getSnapshot().microphones.length, 1);
  manager.dispose();
});

test('mantém microfone e compartilhamento independentes quando a câmera é negada', async () => {
  const mediaDevices = new FakeMediaDevices();
  mediaDevices.devices = [camera, microphone];
  mediaDevices.cameraError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });
  await manager.initialize();

  assert.equal(await manager.camera.start(), undefined);
  assert.equal(manager.getSnapshot().camera.state, CameraState.PERMISSION_DENIED);
  assert.notEqual(await manager.microphone.start(), undefined);
  assert.equal(manager.getSnapshot().microphone.state, MicrophoneState.ACTIVE);
  assert.notEqual(await manager.screenShare.start(), undefined);
  assert.equal(manager.getSnapshot().screenShare.state, ScreenShareState.SHARING);
  manager.dispose();
});

test('encerra somente a faixa removida e mantém os demais módulos ativos', async () => {
  const mediaDevices = new FakeMediaDevices();
  mediaDevices.devices = [camera, microphone];
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });
  await manager.initialize();
  await manager.camera.start();
  await manager.microphone.start();

  mediaDevices.devices = [microphone];
  await manager.refreshDevices();

  assert.equal(manager.getSnapshot().camera.state, CameraState.NOT_FOUND);
  assert.equal(mediaDevices.cameraTrack.stopped, true);
  assert.equal(manager.getSnapshot().microphone.state, MicrophoneState.ACTIVE);
  assert.equal(mediaDevices.microphoneTrack.stopped, false);
  manager.dispose();
});

test('reflete o encerramento pelo seletor nativo de compartilhamento', async () => {
  const mediaDevices = new FakeMediaDevices();
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });
  await manager.initialize();
  await manager.screenShare.start();

  mediaDevices.screenTrack.end();

  assert.equal(manager.getSnapshot().screenShare.state, ScreenShareState.STOPPED);
  manager.dispose();
});

test('converte falha de enumeração em estado e mensagem amigáveis', async () => {
  const mediaDevices = new FakeMediaDevices();
  mediaDevices.enumerateError = new Error('technical device failure');
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });

  const snapshot = await manager.initialize();

  assert.equal(snapshot.camera.state, CameraState.ERROR);
  assert.equal(snapshot.microphone.state, MicrophoneState.ERROR);
  assert.equal(snapshot.scanError, 'Não foi possível verificar os dispositivos de mídia.');
  assert.doesNotMatch(snapshot.scanError, /technical/);
  manager.dispose();
});

test('coalesce atualizações concorrentes de dispositivos', async () => {
  const mediaDevices = new FakeMediaDevices();
  mediaDevices.devices = [camera, microphone];
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });
  await manager.initialize();

  await Promise.all([manager.refreshDevices(), manager.refreshDevices(), manager.refreshDevices()]);

  assert.equal(mediaDevices.enumerateCalls, 2);
  manager.dispose();
});

test('descarta atualização assíncrona concluída depois do encerramento', async () => {
  const mediaDevices = new FakeMediaDevices();
  const gate = createDeferred();
  mediaDevices.enumerateGate = gate.promise;
  const manager = new MediaDeviceManager({ mediaDevices, logger: silentLogger });

  const refresh = manager.refreshDevices();
  manager.dispose();
  mediaDevices.devices = [camera, microphone];
  gate.resolve();
  await refresh;

  assert.equal(manager.getSnapshot().cameras.length, 0);
  assert.equal(manager.getSnapshot().microphones.length, 0);
});

async function waitForMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(): void {
      resolvePromise?.();
    },
  };
}
