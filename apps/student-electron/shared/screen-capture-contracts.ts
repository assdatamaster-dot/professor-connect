export interface ScreenCaptureDisplayLayout {
  readonly displayId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AllScreensCaptureLayout {
  readonly width: number;
  readonly height: number;
  readonly displays: readonly ScreenCaptureDisplayLayout[];
}
