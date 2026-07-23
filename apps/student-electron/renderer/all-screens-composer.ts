import type {
  AllScreensCaptureLayout,
  ScreenCaptureDisplayLayout,
} from '../shared/screen-capture-contracts.js';

const MAXIMUM_COMPOSITE_WIDTH = 3840;
const MAXIMUM_COMPOSITE_HEIGHT = 2160;
const COMPOSITE_FRAME_RATE = 30;

export type DisplayMediaCapture = () => Promise<MediaStream>;

export class AllScreensCompositeCapture {
  private animationFrame: number | undefined;
  private disposed = false;
  private readonly sourceEndedListeners = new Map<MediaStreamTrack, () => void>();

  private constructor(
    private readonly layout: AllScreensCaptureLayout,
    private readonly sourceStreams: readonly MediaStream[],
    private readonly videos: readonly HTMLVideoElement[],
    private readonly canvas: HTMLCanvasElement,
    private readonly context: CanvasRenderingContext2D,
    public readonly stream: MediaStream,
    private readonly onSourceEnded: () => void,
  ) {}

  public static async start(
    layout: AllScreensCaptureLayout,
    firstStream: MediaStream,
    captureNext: DisplayMediaCapture,
    onSourceEnded: () => void,
  ): Promise<AllScreensCompositeCapture> {
    if (layout.displays.length === 0) {
      throw new Error('Nenhum monitor disponível para composição');
    }

    const sourceStreams: MediaStream[] = [firstStream];
    try {
      while (sourceStreams.length < layout.displays.length) {
        sourceStreams.push(await captureNext());
      }
      const videos = await Promise.all(sourceStreams.map(createCaptureVideo));
      const compositeSize = calculateCompositeSize(layout.width, layout.height);
      const canvas = document.createElement('canvas');
      canvas.width = compositeSize.width;
      canvas.height = compositeSize.height;
      const context = canvas.getContext('2d', { alpha: false });
      if (context === null) {
        throw new Error('Canvas de composição não está disponível');
      }
      const outputStream = canvas.captureStream(COMPOSITE_FRAME_RATE);
      const capture = new AllScreensCompositeCapture(
        layout,
        sourceStreams,
        videos,
        canvas,
        context,
        outputStream,
        onSourceEnded,
      );
      capture.start();
      return capture;
    } catch (error) {
      stopStreams(sourceStreams.slice(1));
      throw error;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    for (const [track, listener] of this.sourceEndedListeners) {
      track.removeEventListener('ended', listener);
    }
    this.sourceEndedListeners.clear();
    stopStreams(this.sourceStreams.slice(1));
    for (const video of this.videos) {
      video.pause();
      video.srcObject = null;
    }
    stopStreams([this.stream]);
  }

  private start(): void {
    for (const stream of this.sourceStreams) {
      const track = stream.getVideoTracks()[0];
      if (track === undefined) {
        throw new Error('Uma captura de monitor não possui faixa de vídeo');
      }
      const listener = (): void => {
        if (!this.disposed) {
          this.onSourceEnded();
        }
      };
      this.sourceEndedListeners.set(track, listener);
      track.addEventListener('ended', listener, { once: true });
    }
    this.drawFrame();
  }

  private readonly drawFrame = (): void => {
    if (this.disposed) {
      return;
    }
    this.context.fillStyle = '#000';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scaleX = this.canvas.width / this.layout.width;
    const scaleY = this.canvas.height / this.layout.height;
    this.layout.displays.forEach((display, index) => {
      drawDisplay(this.context, this.videos[index]!, display, scaleX, scaleY);
    });
    this.animationFrame = requestAnimationFrame(this.drawFrame);
  };
}

export function calculateCompositeSize(
  sourceWidth: number,
  sourceHeight: number,
): { readonly width: number; readonly height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Dimensões do desktop virtual são inválidas');
  }
  const scale = Math.min(
    1,
    MAXIMUM_COMPOSITE_WIDTH / sourceWidth,
    MAXIMUM_COMPOSITE_HEIGHT / sourceHeight,
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

async function createCaptureVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener(
        'error',
        () => reject(new Error('Não foi possível preparar a captura de um monitor')),
        { once: true },
      );
    });
  }
  await video.play();
  return video;
}

function drawDisplay(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  display: ScreenCaptureDisplayLayout,
  scaleX: number,
  scaleY: number,
): void {
  context.drawImage(
    video,
    Math.round(display.x * scaleX),
    Math.round(display.y * scaleY),
    Math.round(display.width * scaleX),
    Math.round(display.height * scaleY),
  );
}

function stopStreams(streams: readonly MediaStream[]): void {
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
