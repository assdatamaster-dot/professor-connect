export enum CameraState {
  AVAILABLE = 'CAMERA_AVAILABLE',
  ACTIVE = 'CAMERA_ACTIVE',
  DISABLED = 'CAMERA_DISABLED',
  NOT_FOUND = 'CAMERA_NOT_FOUND',
  PERMISSION_DENIED = 'CAMERA_PERMISSION_DENIED',
  ERROR = 'CAMERA_ERROR',
}

export enum MicrophoneState {
  ACTIVE = 'MIC_ACTIVE',
  MUTED = 'MIC_MUTED',
  NOT_FOUND = 'MIC_NOT_FOUND',
  PERMISSION_DENIED = 'MIC_PERMISSION_DENIED',
  ERROR = 'MIC_ERROR',
}

export enum ScreenShareState {
  IDLE = 'SCREEN_IDLE',
  SHARING = 'SCREEN_SHARING',
  STOPPED = 'SCREEN_STOPPED',
  PERMISSION_DENIED = 'SCREEN_PERMISSION_DENIED',
  ERROR = 'SCREEN_ERROR',
}

export type DeviceIndicator = 'active' | 'inactive' | 'pending' | 'unavailable' | 'error';

export interface DeviceStatus<TState extends string> {
  readonly state: TState;
  readonly message: string;
  readonly indicator: DeviceIndicator;
}

export const CAMERA_STATUS: Readonly<Record<CameraState, DeviceStatus<CameraState>>> =
  Object.freeze({
    [CameraState.AVAILABLE]: {
      state: CameraState.AVAILABLE,
      message: 'Câmera disponível.',
      indicator: 'inactive',
    },
    [CameraState.ACTIVE]: {
      state: CameraState.ACTIVE,
      message: 'Câmera ligada.',
      indicator: 'active',
    },
    [CameraState.DISABLED]: {
      state: CameraState.DISABLED,
      message: 'Câmera desligada.',
      indicator: 'inactive',
    },
    [CameraState.NOT_FOUND]: {
      state: CameraState.NOT_FOUND,
      message: 'Nenhuma câmera encontrada.',
      indicator: 'unavailable',
    },
    [CameraState.PERMISSION_DENIED]: {
      state: CameraState.PERMISSION_DENIED,
      message: 'Permissão para câmera negada.',
      indicator: 'error',
    },
    [CameraState.ERROR]: {
      state: CameraState.ERROR,
      message: 'Erro ao acessar a câmera.',
      indicator: 'error',
    },
  });

export const MICROPHONE_STATUS: Readonly<Record<MicrophoneState, DeviceStatus<MicrophoneState>>> =
  Object.freeze({
    [MicrophoneState.ACTIVE]: {
      state: MicrophoneState.ACTIVE,
      message: 'Microfone ligado.',
      indicator: 'active',
    },
    [MicrophoneState.MUTED]: {
      state: MicrophoneState.MUTED,
      message: 'Microfone mutado.',
      indicator: 'inactive',
    },
    [MicrophoneState.NOT_FOUND]: {
      state: MicrophoneState.NOT_FOUND,
      message: 'Nenhum microfone encontrado.',
      indicator: 'unavailable',
    },
    [MicrophoneState.PERMISSION_DENIED]: {
      state: MicrophoneState.PERMISSION_DENIED,
      message: 'Permissão para microfone negada.',
      indicator: 'error',
    },
    [MicrophoneState.ERROR]: {
      state: MicrophoneState.ERROR,
      message: 'Erro ao acessar o microfone.',
      indicator: 'error',
    },
  });

export const SCREEN_SHARE_STATUS: Readonly<
  Record<ScreenShareState, DeviceStatus<ScreenShareState>>
> = Object.freeze({
  [ScreenShareState.IDLE]: {
    state: ScreenShareState.IDLE,
    message: 'Não compartilhando.',
    indicator: 'inactive',
  },
  [ScreenShareState.SHARING]: {
    state: ScreenShareState.SHARING,
    message: 'Compartilhando tela.',
    indicator: 'active',
  },
  [ScreenShareState.STOPPED]: {
    state: ScreenShareState.STOPPED,
    message: 'Compartilhamento encerrado.',
    indicator: 'inactive',
  },
  [ScreenShareState.PERMISSION_DENIED]: {
    state: ScreenShareState.PERMISSION_DENIED,
    message: 'Permissão para compartilhar a tela negada.',
    indicator: 'error',
  },
  [ScreenShareState.ERROR]: {
    state: ScreenShareState.ERROR,
    message: 'Erro ao compartilhar a tela.',
    indicator: 'error',
  },
});
