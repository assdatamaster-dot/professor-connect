import { StateMachine, type StateTransition } from '@professor-connect/services/state-machine';
import { ScreenShareFailureCode } from '@professor-connect/protocol';

import { BrowserMediaStream } from '../../../modules/webrtc/media.service.js';
import type { MediaStreamPort, WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import { SCREEN_SHARING_STATE_TRANSITIONS } from './screen-sharing.events.js';
import {
  ScreenSharingState,
  type ScreenCaptureDevicesPort,
  type ScreenSharingContext,
  type ScreenSharingFailedListener,
  type ScreenSharingFailure,
  type ScreenSharingManagerDependencies,
  type ScreenSharingManagerPort,
  type ScreenSharingStateListener,
  type ScreenSharingStoppedListener,
} from './screen-sharing.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class BrowserScreenCaptureDevices implements ScreenCaptureDevicesPort {
  public async getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStreamPort> {
    const mediaDevices = globalThis.navigator?.mediaDevices;

    if (mediaDevices?.getDisplayMedia === undefined) {
      throw new Error('getDisplayMedia não está disponível neste ambiente');
    }

    return new BrowserMediaStream(await mediaDevices.getDisplayMedia(constraints));
  }
}

export class ScreenSharingManager implements ScreenSharingManagerPort {
  private readonly stateMachine: StateMachine<ScreenSharingState>;
  private readonly stoppedListeners = new Set<ScreenSharingStoppedListener>();
  private readonly failedListeners = new Set<ScreenSharingFailedListener>();
  private readonly logger: WebRtcLogger;
  private context: ScreenSharingContext | undefined;
  private screenStream: MediaStreamPort | undefined;

  public constructor(private readonly dependencies: ScreenSharingManagerDependencies) {
    this.logger = dependencies.logger ?? silentLogger;
    this.stateMachine = new StateMachine(
      ScreenSharingState.IDLE,
      SCREEN_SHARING_STATE_TRANSITIONS,
      {
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
        logger: this.logger,
        context: { component: 'screen-sharing' },
      },
    );
  }

  public request(context: ScreenSharingContext): void {
    requireContext(context);
    this.stateMachine.transitionTo(ScreenSharingState.REQUESTED);
    this.context = context;
  }

  public async startLocal(): Promise<void> {
    const context = this.requireContext();

    this.stateMachine.transitionTo(ScreenSharingState.STARTING);
    let stream: MediaStreamPort;

    try {
      stream = await this.dependencies.captureDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    } catch (error) {
      this.fail(context, { code: ScreenShareFailureCode.CAPTURE_FAILED, error });
      throw error;
    }

    this.screenStream = stream;
    const screenTrack = stream.getVideoTracks()[0];

    if (screenTrack === undefined) {
      const error = new Error('A captura de tela não forneceu faixa de vídeo');

      this.stopScreenStream();
      this.fail(context, { code: ScreenShareFailureCode.CAPTURE_FAILED, error });
      throw error;
    }

    screenTrack.setEndedHandler(() => {
      void this.handleCaptureEnded();
    });

    try {
      await this.dependencies.trackController.replaceVideoTrack(screenTrack);
      await this.dependencies.mediaManager.renderStream(stream, this.dependencies.localRenderer);
      this.stateMachine.transitionTo(ScreenSharingState.SHARING);
      this.logger.info('Captura iniciada', {
        callId: context.callId,
        requestId: context.requestId,
      });
      this.logger.info('Troca de track', {
        callId: context.callId,
        source: 'screen',
      });
    } catch (error) {
      await this.restoreCameraSafely();
      this.stopScreenStream();
      this.fail(context, { code: ScreenShareFailureCode.TRACK_REPLACEMENT_FAILED, error });
      throw error;
    }
  }

  public acceptRemote(): void {
    this.requireContext();
    this.stateMachine.transitionTo(ScreenSharingState.STARTING);
  }

  public markStartedRemote(): void {
    this.requireContext();
    this.stateMachine.transitionTo(ScreenSharingState.SHARING);
  }

  public deny(): void {
    this.requireContext();
    this.stateMachine.transitionTo(ScreenSharingState.STOPPED);
  }

  public async stopLocal(): Promise<void> {
    const context = this.requireContext();

    if (this.getState() !== ScreenSharingState.SHARING) {
      return;
    }

    this.stateMachine.transitionTo(ScreenSharingState.STOPPING);
    try {
      await this.dependencies.trackController.restoreCameraVideoTrack();
      await this.dependencies.mediaManager.renderLocal(this.dependencies.localRenderer);
      this.logger.info('Troca de track', {
        callId: context.callId,
        source: 'camera',
      });
      this.stopScreenStream();
      this.stateMachine.transitionTo(ScreenSharingState.STOPPED);
      this.logger.info('Captura encerrada', {
        callId: context.callId,
        requestId: context.requestId,
      });
      for (const listener of this.stoppedListeners) {
        listener(context);
      }
    } catch (error) {
      this.stopScreenStream();
      this.fail(context, { code: ScreenShareFailureCode.TRACK_REPLACEMENT_FAILED, error });
      throw error;
    }
  }

  public markStoppedRemote(): void {
    this.requireContext();
    this.stateMachine.transitionTo(ScreenSharingState.STOPPING);
    this.stateMachine.transitionTo(ScreenSharingState.STOPPED);
  }

  public failRemote(): void {
    this.requireContext();
    this.stateMachine.transitionTo(ScreenSharingState.FAILED);
  }

  public getContext(): ScreenSharingContext | undefined {
    return this.context;
  }

  public getState(): ScreenSharingState {
    return this.stateMachine.getCurrentState();
  }

  public hasLocalCapture(): boolean {
    return this.screenStream !== undefined;
  }

  public getStateHistory(): readonly StateTransition<ScreenSharingState>[] {
    return this.stateMachine.getHistory();
  }

  public onStateChanged(listener: ScreenSharingStateListener): () => void {
    return this.stateMachine.onTransition(listener);
  }

  public onLocalStopped(listener: ScreenSharingStoppedListener): () => void {
    this.stoppedListeners.add(listener);
    return () => this.stoppedListeners.delete(listener);
  }

  public onLocalFailed(listener: ScreenSharingFailedListener): () => void {
    this.failedListeners.add(listener);
    return () => this.failedListeners.delete(listener);
  }

  private async handleCaptureEnded(): Promise<void> {
    if (this.getState() === ScreenSharingState.SHARING) {
      await this.stopLocal();
    }
  }

  private fail(context: ScreenSharingContext, failure: ScreenSharingFailure): void {
    if (this.getState() !== ScreenSharingState.FAILED) {
      this.stateMachine.transitionTo(ScreenSharingState.FAILED);
    }
    this.logger.error('Falhas', failure.error);
    for (const listener of this.failedListeners) {
      listener(context, failure);
    }
  }

  private async restoreCameraSafely(): Promise<void> {
    try {
      await this.dependencies.trackController.restoreCameraVideoTrack();
      await this.dependencies.mediaManager.renderLocal(this.dependencies.localRenderer);
    } catch (error) {
      this.logger.error('Falhas', error);
    }
  }

  private stopScreenStream(): void {
    const stream = this.screenStream;

    this.screenStream = undefined;
    if (stream !== undefined) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  private requireContext(): ScreenSharingContext {
    if (this.context === undefined) {
      throw new Error('Solicitação de compartilhamento não encontrada');
    }

    return this.context;
  }
}

function requireContext(context: ScreenSharingContext): void {
  if (
    context.callId.trim().length === 0 ||
    context.sessionId.trim().length === 0 ||
    context.requestId.trim().length === 0
  ) {
    throw new Error('callId, sessionId e requestId são obrigatórios');
  }
}
