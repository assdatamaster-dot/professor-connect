import {
  CameraState,
  MediaDeviceManager,
  MicrophoneState,
  type MediaDeviceSnapshot,
} from './media-devices/index.js';
import {
  ProfessorPresenceStatus,
  type AttendanceHistoryItem,
  type ProfessorPresenceSnapshot,
} from '../shared/presence-contracts.js';
import type { TeacherRemoteControlSnapshot } from '../shared/remote-control-contracts.js';
import { FILE_TRANSFER_DATA_CHANNEL_LABEL, FileTransferClient } from './file-transfer.client.js';
import { RemoteControlClient } from './remote-control.client.js';
import { toUserFacingErrorMessage } from './error-message.js';

const MAXIMUM_PENDING_ICE_CANDIDATES = 256;
const WEBRTC_RECOVERY_DELAY_MS = 3_000;
const loginView = requireElement<HTMLElement>('login-view');
const onlineView = requireElement<HTMLElement>('online-view');
const loginForm = requireElement<HTMLFormElement>('login-form');
const emailInput = requireElement<HTMLInputElement>('login-email');
const passwordInput = requireElement<HTMLInputElement>('login-password');
const loginButton = requireElement<HTMLButtonElement>('login-button');
const loginError = requireElement<HTMLElement>('login-error');
const authTitle = requireElement<HTMLElement>('auth-title');
const authIntro = requireElement<HTMLElement>('auth-intro');
const showRegisterButton = requireElement<HTMLButtonElement>('show-register');
const showLoginButton = requireElement<HTMLButtonElement>('show-login');
const registerForm = requireElement<HTMLFormElement>('register-form');
const registerName = requireElement<HTMLInputElement>('register-name');
const registerEmail = requireElement<HTMLInputElement>('register-email');
const registerPassword = requireElement<HTMLInputElement>('register-password');
const registerConfirmPassword = requireElement<HTMLInputElement>('register-confirm-password');
const passwordFeedback = requireElement<HTMLElement>('password-feedback');
const confirmFeedback = requireElement<HTMLElement>('confirm-feedback');
const registerError = requireElement<HTMLElement>('register-error');
const registerButton = requireElement<HTMLButtonElement>('register-button');
const professorDisplayName = requireElement<HTMLElement>('professor-display-name');
const presencePill = requireElement<HTMLElement>('presence-pill');
const presenceStatus = requireElement<HTMLElement>('presence-status');
const availabilityToggle = requireElement<HTMLButtonElement>('availability-toggle');
const availabilityToggleText = availabilityToggle.querySelector<HTMLElement>('span');
const availabilityCopy = requireElement<HTMLElement>('availability-copy');
const teacherHistory = requireElement<HTMLButtonElement>('teacher-history');
const teacherHistoryDialog = requireElement<HTMLDialogElement>('teacher-history-dialog');
const teacherHistoryList = requireElement<HTMLUListElement>('teacher-history-list');
const teacherHistoryClose = requireElement<HTMLButtonElement>('teacher-history-close');
const serverStatus = requireElement<HTMLElement>('server-status');
const sessionNotice = requireElement<HTMLElement>('session-notice');
const logoutButton = requireElement<HTMLButtonElement>('logout-button');
const profileButton = requireElement<HTMLButtonElement>('profile-button');
const profileDialog = requireElement<HTMLDialogElement>('profile-dialog');
const profileForm = requireElement<HTMLFormElement>('profile-form');
const profileName = requireElement<HTMLInputElement>('profile-name');
const profileAvatar = requireElement<HTMLInputElement>('profile-avatar');
const profileCurrentPassword = requireElement<HTMLInputElement>('profile-current-password');
const profilePassword = requireElement<HTMLInputElement>('profile-password');
const profileConfirmPassword = requireElement<HTMLInputElement>('profile-confirm-password');
const profileError = requireElement<HTMLElement>('profile-error');
const profileSave = requireElement<HTMLButtonElement>('profile-save');
const profileCancel = requireElement<HTMLButtonElement>('profile-cancel');
const activeAttendance = requireElement<HTMLElement>('active-attendance');
const activeStudentName = requireElement<HTMLElement>('active-student-name');
const endSessionButton = requireElement<HTMLButtonElement>('end-session');
const attendanceState = requireElement<HTMLElement>('attendance-state');
const webRtcMedia = requireElement<HTMLElement>('webrtc-media');
const localVideo = requireElement<HTMLVideoElement>('teacher-local-video');
const remoteVideo = requireElement<HTMLVideoElement>('teacher-remote-video');
const screenShareView = requireElement<HTMLElement>('screen-share-view');
const screenVideo = requireElement<HTMLVideoElement>('teacher-screen-video');
const localVideoPlaceholder = requireElement<HTMLElement>('local-video-placeholder');
const localVideoPlaceholderTitle = requireElement<HTMLElement>('local-video-placeholder-title');
const remoteVideoPlaceholder = requireElement<HTMLElement>('remote-video-placeholder');
const screenVideoPlaceholder = requireElement<HTMLElement>('screen-video-placeholder');
const cameraStatus = requireElement<HTMLElement>('camera-status');
const cameraIndicator = requireElement<HTMLElement>('camera-indicator');
const cameraButton = requireElement<HTMLButtonElement>('toggle-camera');
const microphoneStatus = requireElement<HTMLElement>('microphone-status');
const microphoneIndicator = requireElement<HTMLElement>('microphone-indicator');
const microphoneButton = requireElement<HTMLButtonElement>('toggle-microphone');
const screenStatus = requireElement<HTMLElement>('screen-status');
const screenIndicator = requireElement<HTMLElement>('screen-indicator');
const deviceScanMessage = requireElement<HTMLElement>('device-scan-message');
const sessionDialog = requireElement<HTMLDialogElement>('session-request-dialog');
const requestStudentName = requireElement<HTMLElement>('request-student-name');
const acceptSessionButton = requireElement<HTMLButtonElement>('accept-session');
const rejectSessionButton = requireElement<HTMLButtonElement>('reject-session');
const requestRemoteControlButton = requireElement<HTMLButtonElement>('request-remote-control');
const stopRemoteControlButton = requireElement<HTMLButtonElement>('stop-remote-control');
const remoteControlStatus = requireElement<HTMLElement>('remote-control-status');
const remoteControlIndicator = requireElement<HTMLElement>('remote-control-indicator');
const remoteMouseIndicator = requireElement<HTMLElement>('remote-mouse-indicator');
const remoteKeyboardIndicator = requireElement<HTMLElement>('remote-keyboard-indicator');
const remoteControlLog = requireElement<HTMLUListElement>('remote-control-log');
const fileTransferButton = requireElement<HTMLButtonElement>('file-transfer-button');
const fileTransferPanel = requireElement<HTMLElement>('file-transfer-panel');
const fileTransferList = requireElement<HTMLUListElement>('file-transfer-list');
const fileTransferDropZone = requireElement<HTMLElement>('file-transfer-drop-zone');
const fileTransferDestination = requireElement<HTMLElement>('file-transfer-destination');
const fileTransferAutoReceive = requireElement<HTMLInputElement>('file-transfer-auto-receive');
const fileTransferChangeDestination = requireElement<HTMLButtonElement>(
  'file-transfer-change-destination',
);
const connectionQuality = requireElement<HTMLElement>('teacher-connection-quality');
const sessionDuration = requireElement<HTMLTimeElement>('teacher-session-duration');
const dockMicrophoneButton = requireElement<HTMLButtonElement>('teacher-dock-microphone');
const dockCameraButton = requireElement<HTMLButtonElement>('teacher-dock-camera');
const dockScreenStatus = requireElement<HTMLElement>('teacher-dock-screen');
const dockControlButton = requireElement<HTMLButtonElement>('teacher-dock-control');
const dockFilesButton = requireElement<HTMLButtonElement>('teacher-dock-files');
const closeFilesButton = requireElement<HTMLButtonElement>('teacher-close-files');
const retryCameraButton = requireElement<HTMLButtonElement>('teacher-retry-camera');
let activeRequestId: string | undefined;
const mediaDeviceManager = new MediaDeviceManager();
let peerConnection: RTCPeerConnection | undefined;
let cameraSender: RTCRtpSender | undefined;
let microphoneSender: RTCRtpSender | undefined;
let isPreparingInitialMedia = false;
let activeWebRtcSessionId: string | undefined;
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const remoteStreams = new Map<string, MediaStream>();
let remoteMediaStream = new MediaStream();
let announcedScreenStreamId: string | undefined;
let announcedScreenTrackId: string | undefined;
let renegotiationQueue = Promise.resolve();
let webRtcRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
let webRtcRecoveryInFlight = false;
let sessionClockTimer: ReturnType<typeof setInterval> | undefined;
let sessionStartedAt: number | undefined;
let timedSessionId: string | undefined;
const remoteControlClient = new RemoteControlClient(
  screenVideo,
  {
    sendMouse: (event) => window.professorConnectPresence.sendRemoteControlMouse(event),
    sendKeyboard: (event) => window.professorConnectPresence.sendRemoteControlKeyboard(event),
  },
  () => {
    attendanceState.textContent = 'Não foi possível transmitir o evento de controle remoto.';
  },
  async () => {
    await window.professorConnectPresence.stopRemoteControl();
  },
);
const fileTransferClient = new FileTransferClient({
  api: window.professorConnectFileTransfer,
  elements: {
    button: fileTransferButton,
    panel: fileTransferPanel,
    list: fileTransferList,
    dropZone: fileTransferDropZone,
    destination: fileTransferDestination,
    autoReceive: fileTransferAutoReceive,
    changeDestination: fileTransferChangeDestination,
  },
  getLocalName: () => professorDisplayName.textContent ?? 'Professor',
  notify: (message) => {
    attendanceState.textContent = message;
  },
  onIncoming: () => setFileDrawerOpen(true),
});

function render(snapshot: ProfessorPresenceSnapshot): void {
  const isActive = snapshot.professorName !== undefined;

  loginView.hidden = isActive;
  onlineView.hidden = !isActive;
  loginButton.disabled = snapshot.status === ProfessorPresenceStatus.CONNECTING;

  if (!isActive) {
    remoteControlClient.stop();
    fileTransferClient.endSession();
    emailInput.focus();
    return;
  }

  professorDisplayName.textContent = snapshot.professorName ?? '';
  presencePill.dataset.status = snapshot.status;
  presenceStatus.textContent = getPresenceLabel(snapshot.status);
  availabilityToggle.setAttribute('aria-pressed', String(snapshot.available));
  if (availabilityToggleText !== null) {
    availabilityToggleText.textContent = snapshot.available ? 'Disponível' : 'Indisponível';
  }
  const isReserved = snapshot.sessionRequests.length > 0;
  availabilityCopy.textContent = isReserved
    ? 'Solicitação aguardando sua resposta'
    : snapshot.available
      ? 'Você está disponível'
      : 'Você está indisponível';
  availabilityToggle.disabled =
    !snapshot.serverConnected || snapshot.activeSession !== undefined || isReserved;
  serverStatus.textContent = snapshot.serverConnected ? 'Conectado' : 'Desconectado';
  sessionNotice.textContent = snapshot.sessionNotice ?? '';
  sessionNotice.hidden = snapshot.sessionNotice === undefined;
  activeAttendance.hidden = snapshot.activeSession === undefined;
  activeStudentName.textContent = snapshot.activeSession?.studentName ?? '';
  dockFilesButton.disabled = snapshot.activeSession === undefined;
  if (snapshot.activeSession === undefined) {
    setFileDrawerOpen(false);
    fileTransferClient.endSession();
    closeWebRtcSession();
  } else {
    fileTransferClient.beginSession(
      snapshot.activeSession.sessionId,
      snapshot.activeSession.studentName,
    );
    if (activeWebRtcSessionId !== snapshot.activeSession.sessionId) {
      void startTeacherWebRtc(snapshot.activeSession.sessionId);
    }
  }
  renderRemoteControl(snapshot.remoteControl, snapshot.activeSession !== undefined);
  renderSessionRequest(snapshot);
}

function renderRemoteControl(
  snapshot: TeacherRemoteControlSnapshot,
  hasActiveSession: boolean,
): void {
  requestRemoteControlButton.disabled = !hasActiveSession || snapshot.status !== 'inactive';
  requestRemoteControlButton.textContent =
    snapshot.status === 'pending' ? 'Aguardando autorização...' : 'Solicitar Controle';
  stopRemoteControlButton.hidden = snapshot.status === 'inactive';
  stopRemoteControlButton.disabled = !hasActiveSession;
  remoteControlStatus.textContent =
    snapshot.status === 'active'
      ? 'Controle Remoto Ativo'
      : snapshot.status === 'pending'
        ? 'Aguardando autorização do aluno'
        : 'Controle Remoto Inativo';
  remoteControlIndicator.dataset.indicator =
    snapshot.status === 'active'
      ? 'active'
      : snapshot.status === 'pending'
        ? 'pending'
        : 'inactive';
  remoteMouseIndicator.dataset.indicator = snapshot.status === 'active' ? 'active' : 'inactive';
  remoteKeyboardIndicator.dataset.indicator = snapshot.status === 'active' ? 'active' : 'inactive';
  dockControlButton.dataset.state = snapshot.status;
  dockControlButton.disabled = !hasActiveSession || snapshot.status === 'pending';
  dockControlButton.setAttribute(
    'aria-label',
    snapshot.status === 'active' ? 'Parar controle remoto' : 'Solicitar controle remoto',
  );
  dockControlButton.setAttribute('aria-pressed', String(snapshot.status === 'active'));

  if (snapshot.status === 'active') {
    remoteControlClient.start();
  } else {
    remoteControlClient.stop();
  }

  const entries = snapshot.logs.map((entry) => {
    const item = document.createElement('li');
    item.textContent = `${formatRemoteControlTime(entry.timestamp)} · ${entry.message}`;
    return item;
  });
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Nenhuma atividade de controle remoto.';
    remoteControlLog.replaceChildren(empty);
  } else {
    remoteControlLog.replaceChildren(...entries.reverse());
  }
}

function formatRemoteControlTime(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function renderSessionRequest(snapshot: ProfessorPresenceSnapshot): void {
  const request = snapshot.sessionRequests[0];
  activeRequestId = request?.requestId;

  if (request === undefined) {
    if (sessionDialog.open) {
      sessionDialog.close();
    }
    return;
  }

  requestStudentName.textContent = request.studentName;
  if (!sessionDialog.open) {
    sessionDialog.showModal();
  }
}

function getPresenceLabel(status: ProfessorPresenceStatus): string {
  switch (status) {
    case ProfessorPresenceStatus.CONNECTED:
      return 'Online';
    case ProfessorPresenceStatus.CONNECTING:
      return 'Conectando';
    case ProfessorPresenceStatus.ERROR:
      return 'Erro de conexão';
    case ProfessorPresenceStatus.DISCONNECTED:
      return 'Offline';
  }
}

function requireElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Elemento obrigatório ausente: ${id}`);
  }
  return element as TElement;
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;

  void window.professorConnectAuth
    .login({
      email: emailInput.value,
      password: passwordInput.value,
    })
    .then(() => {
      passwordInput.value = '';
    })
    .catch((error: unknown) => {
      loginButton.disabled = false;
      loginError.textContent = toUserFacingErrorMessage(error, 'Não foi possível conectar.');
      loginError.hidden = false;
    });
});

function showRegistration(show: boolean): void {
  loginForm.hidden = show;
  registerForm.hidden = !show;
  authTitle.textContent = show ? 'Crie sua conta' : 'Bem-vindo de volta';
  authIntro.textContent = show
    ? 'Leva menos de um minuto. Você entrará como professor.'
    : 'Entre para ficar disponível aos alunos.';
  loginError.hidden = true;
  registerError.hidden = true;
  (show ? registerName : emailInput).focus();
}

function validateRegistrationPassword(): void {
  const value = registerPassword.value;
  const valid =
    value.length >= 12 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value);
  passwordFeedback.dataset.valid = String(valid);
  passwordFeedback.textContent = valid
    ? 'Senha forte.'
    : 'Use 12 caracteres, maiúscula, minúscula, número e símbolo.';
  const matches = value.length > 0 && value === registerConfirmPassword.value;
  confirmFeedback.dataset.valid = String(matches);
  confirmFeedback.textContent =
    registerConfirmPassword.value.length === 0
      ? ''
      : matches
        ? 'As senhas conferem.'
        : 'As senhas não conferem.';
  registerButton.disabled = !valid || !matches;
}

showRegisterButton.addEventListener('click', () => showRegistration(true));
showLoginButton.addEventListener('click', () => showRegistration(false));
registerPassword.addEventListener('input', validateRegistrationPassword);
registerConfirmPassword.addEventListener('input', validateRegistrationPassword);
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  validateRegistrationPassword();
  if (registerButton.disabled || !registerForm.checkValidity()) return;
  registerButton.disabled = true;
  registerError.hidden = true;
  void window.professorConnectAuth
    .register({
      name: registerName.value,
      email: registerEmail.value,
      password: registerPassword.value,
      confirmPassword: registerConfirmPassword.value,
      role: 'TEACHER',
    })
    .then(() => {
      registerForm.reset();
      validateRegistrationPassword();
    })
    .catch((error: unknown) => {
      registerError.textContent = toUserFacingErrorMessage(
        error,
        'Não foi possível criar sua conta.',
      );
      registerError.hidden = false;
      registerButton.disabled = false;
    });
});

profileButton.addEventListener('click', () => {
  profileButton.disabled = true;
  profileError.hidden = true;
  void window.professorConnectAuth
    .getProfile()
    .then((profile) => {
      profileName.value = profile.name;
      profileAvatar.value = profile.avatar ?? '';
      profileCurrentPassword.value = '';
      profilePassword.value = '';
      profileConfirmPassword.value = '';
      profileDialog.showModal();
    })
    .catch((error: unknown) => {
      sessionNotice.textContent = toUserFacingErrorMessage(
        error,
        'Não foi possível carregar o perfil.',
      );
      sessionNotice.hidden = false;
    })
    .finally(() => {
      profileButton.disabled = false;
    });
});

profileCancel.addEventListener('click', () => profileDialog.close());
profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  profileError.hidden = true;
  const changingPassword = profilePassword.value.length > 0;
  if (changingPassword && profilePassword.value !== profileConfirmPassword.value) {
    profileError.textContent = 'As novas senhas não conferem.';
    profileError.hidden = false;
    return;
  }
  profileSave.disabled = true;
  void window.professorConnectAuth
    .updateProfile({
      name: profileName.value,
      avatar: profileAvatar.value.trim().length === 0 ? null : profileAvatar.value.trim(),
      ...(changingPassword
        ? {
            currentPassword: profileCurrentPassword.value,
            password: profilePassword.value,
            confirmPassword: profileConfirmPassword.value,
          }
        : {}),
    })
    .then((profile) => {
      professorDisplayName.textContent = profile.name;
      profileDialog.close();
      if (changingPassword) showRegistration(false);
    })
    .catch((error: unknown) => {
      profileError.textContent = toUserFacingErrorMessage(
        error,
        'Não foi possível atualizar o perfil.',
      );
      profileError.hidden = false;
    })
    .finally(() => {
      profileSave.disabled = false;
    });
});

logoutButton.addEventListener('click', () => {
  logoutButton.disabled = true;
  void window.professorConnectAuth
    .logout()
    .then(() => window.professorConnectPresence.getState())
    .then((snapshot) => {
      logoutButton.disabled = false;
      passwordInput.value = '';
      render(snapshot);
    });
});

availabilityToggle.addEventListener('click', () => {
  const nextAvailability = availabilityToggle.getAttribute('aria-pressed') !== 'true';
  availabilityToggle.disabled = true;
  void window.professorConnectPresence
    .setAvailability(nextAvailability)
    .then(render)
    .catch((error: unknown) => {
      sessionNotice.textContent =
        error instanceof Error ? error.message : 'Não foi possível alterar a disponibilidade.';
      sessionNotice.hidden = false;
    })
    .finally(() => {
      availabilityToggle.disabled = false;
    });
});

teacherHistory.addEventListener('click', () => {
  teacherHistory.disabled = true;
  teacherHistoryList.replaceChildren(createHistoryMessage('Carregando histórico…'));
  teacherHistoryDialog.showModal();
  void window.professorConnectPresence
    .getHistory()
    .then(renderHistory)
    .catch(() => {
      teacherHistoryList.replaceChildren(
        createHistoryMessage('Não foi possível carregar o histórico.'),
      );
    })
    .finally(() => {
      teacherHistory.disabled = false;
    });
});
teacherHistoryClose.addEventListener('click', () => teacherHistoryDialog.close());

function renderHistory(items: readonly AttendanceHistoryItem[]): void {
  if (items.length === 0) {
    teacherHistoryList.replaceChildren(createHistoryMessage('Nenhum atendimento registrado.'));
    return;
  }
  teacherHistoryList.replaceChildren(
    ...items.map((item) => {
      const element = document.createElement('li');
      const title = document.createElement('strong');
      const details = document.createElement('small');
      const duration = document.createElement('small');
      element.className = 'history-item';
      title.textContent = `Aluno: ${item.student.name}`;
      details.textContent = `${formatHistoryStatus(item.status)} · ${new Intl.DateTimeFormat(
        'pt-BR',
        {
          dateStyle: 'short',
          timeStyle: 'short',
        },
      ).format(new Date(item.startedAt ?? item.requestedAt))}`;
      duration.textContent =
        item.durationSeconds === null
          ? 'Duração não disponível'
          : `Duração: ${Math.floor(item.durationSeconds / 60)}min ${String(
              item.durationSeconds % 60,
            ).padStart(2, '0')}s`;
      element.append(title, details, duration);
      return element;
    }),
  );
}

function createHistoryMessage(message: string): HTMLLIElement {
  const element = document.createElement('li');
  element.className = 'history-item';
  element.textContent = message;
  return element;
}

function formatHistoryStatus(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    PENDING: 'Pendente',
    ACCEPTED: 'Aceita',
    IN_PROGRESS: 'Em andamento',
    FINALIZED: 'Finalizada',
    CANCELLED: 'Cancelada',
    REJECTED: 'Recusada',
    EXPIRED: 'Expirada',
  };
  return labels[status] ?? status;
}

acceptSessionButton.addEventListener('click', () => {
  if (activeRequestId === undefined) {
    return;
  }
  acceptSessionButton.disabled = true;
  rejectSessionButton.disabled = true;
  void window.professorConnectPresence
    .acceptSession(activeRequestId)
    .catch((error: unknown) => {
      sessionNotice.textContent =
        error instanceof Error ? error.message : 'Não foi possível aceitar a solicitação.';
      sessionNotice.hidden = false;
    })
    .finally(() => {
      acceptSessionButton.disabled = false;
      rejectSessionButton.disabled = false;
    });
});

rejectSessionButton.addEventListener('click', () => {
  if (activeRequestId === undefined) {
    return;
  }
  acceptSessionButton.disabled = true;
  rejectSessionButton.disabled = true;
  void window.professorConnectPresence.rejectSession(activeRequestId).finally(() => {
    acceptSessionButton.disabled = false;
    rejectSessionButton.disabled = false;
  });
});

endSessionButton.addEventListener('click', () => {
  endSessionButton.disabled = true;
  void window.professorConnectPresence.endSession().finally(() => {
    endSessionButton.disabled = false;
  });
});
requestRemoteControlButton.addEventListener('click', () => {
  requestRemoteControlButton.disabled = true;
  void window.professorConnectPresence.requestRemoteControl().catch((error: unknown) => {
    attendanceState.textContent =
      error instanceof Error ? error.message : 'Não foi possível solicitar o controle remoto.';
    requestRemoteControlButton.disabled = false;
  });
});
stopRemoteControlButton.addEventListener('click', () => {
  stopRemoteControlButton.disabled = true;
  void window.professorConnectPresence.stopRemoteControl().catch((error: unknown) => {
    attendanceState.textContent =
      error instanceof Error ? error.message : 'Não foi possível encerrar o controle remoto.';
    stopRemoteControlButton.disabled = false;
  });
});
cameraButton.addEventListener('click', () => {
  cameraButton.disabled = true;
  if (mediaDeviceManager.camera.getStatus().state !== CameraState.ACTIVE) {
    cameraStatus.textContent = 'Solicitando permissão para câmera...';
    cameraIndicator.dataset.indicator = 'pending';
  }
  const action =
    mediaDeviceManager.camera.getStatus().state === CameraState.ACTIVE
      ? Promise.resolve(mediaDeviceManager.camera.stop())
      : mediaDeviceManager.camera.start();
  void action.finally(() => {
    cameraButton.disabled = mediaDeviceManager.camera.getStatus().state === CameraState.NOT_FOUND;
  });
});
retryCameraButton.addEventListener('click', () => {
  retryCameraButton.disabled = true;
  void mediaDeviceManager.camera.start().finally(() => {
    retryCameraButton.disabled = false;
  });
});
dockCameraButton.addEventListener('click', () => cameraButton.click());
dockMicrophoneButton.addEventListener('click', () => microphoneButton.click());
dockControlButton.addEventListener('click', () => {
  if (stopRemoteControlButton.hidden) {
    requestRemoteControlButton.click();
  } else {
    stopRemoteControlButton.click();
  }
});
dockFilesButton.addEventListener('click', () => {
  setFileDrawerOpen(!fileTransferPanel.classList.contains('is-open'));
});
closeFilesButton.addEventListener('click', () => setFileDrawerOpen(false));
microphoneButton.addEventListener('click', () => {
  microphoneButton.disabled = true;
  if (mediaDeviceManager.microphone.getStatus().state !== MicrophoneState.ACTIVE) {
    microphoneStatus.textContent = 'Solicitando permissão para microfone...';
    microphoneIndicator.dataset.indicator = 'pending';
  }
  const action =
    mediaDeviceManager.microphone.getStatus().state === MicrophoneState.ACTIVE
      ? Promise.resolve(mediaDeviceManager.microphone.mute())
      : mediaDeviceManager.microphone.start();
  void action.finally(() => {
    microphoneButton.disabled =
      mediaDeviceManager.microphone.getStatus().state === MicrophoneState.NOT_FOUND;
  });
});

const unsubscribe = window.professorConnectPresence.onStateChanged(render);
const unsubscribeAnswer = window.professorConnectWebRtc.onAnswer((payload) => {
  void handleWebRtcAnswer(payload.sessionId, payload.description).catch(() => {
    attendanceState.textContent = 'Não foi possível aplicar a resposta WebRTC.';
  });
});
const unsubscribeOffer = window.professorConnectWebRtc.onOffer((payload) => {
  void handleWebRtcOffer(payload.sessionId, payload.description).catch(() => {
    attendanceState.textContent = 'Não foi possível renegociar o compartilhamento.';
  });
});
const unsubscribeIce = window.professorConnectWebRtc.onIceCandidate((payload) => {
  void handleRemoteIceCandidate(payload.sessionId, payload.candidate).catch(() => {
    attendanceState.textContent = 'Não foi possível aplicar o ICE Candidate.';
  });
});
const unsubscribeScreenShareStarted = window.professorConnectWebRtc.onScreenShareStarted(
  (payload) => {
    if (payload.sessionId !== activeWebRtcSessionId) {
      return;
    }
    announcedScreenStreamId = payload.streamId;
    announcedScreenTrackId = payload.trackId;
    const announcedStream =
      payload.streamId === undefined ? undefined : remoteStreams.get(payload.streamId);
    if (announcedStream !== undefined) {
      screenVideo.srcObject = announcedStream;
    }
    screenShareView.hidden = false;
    screenStatus.textContent = 'Compartilhando tela.';
    screenIndicator.dataset.indicator = 'active';
    dockScreenStatus.dataset.state = 'active';
    attendanceState.textContent = 'Tela compartilhada';
  },
);
const unsubscribeScreenShareStopped = window.professorConnectWebRtc.onScreenShareStopped(
  (payload) => {
    if (payload.sessionId === activeWebRtcSessionId) {
      hideScreenShare();
      screenStatus.textContent = 'Compartilhamento encerrado.';
      screenIndicator.dataset.indicator = 'inactive';
      attendanceState.textContent = 'Aluno conectado';
    }
  },
);
const unsubscribeMediaDevices = mediaDeviceManager.subscribe((snapshot) => {
  renderMediaDevices(snapshot);
  void synchronizeLocalTracks(snapshot).catch(() => {
    attendanceState.textContent = 'Não foi possível atualizar os dispositivos da sessão.';
  });
});
window.addEventListener(
  'beforeunload',
  () => {
    unsubscribe();
    unsubscribeAnswer();
    unsubscribeOffer();
    unsubscribeIce();
    unsubscribeScreenShareStarted();
    unsubscribeScreenShareStopped();
    unsubscribeMediaDevices();
    remoteControlClient.stop();
    fileTransferClient.dispose();
    closeWebRtcSession();
    mediaDeviceManager.dispose();
  },
  { once: true },
);
void window.professorConnectPresence.getState().then(render);
void mediaDeviceManager.initialize();

async function startTeacherWebRtc(sessionId: string): Promise<void> {
  closeWebRtcSession();
  activeWebRtcSessionId = sessionId;
  startSessionClock(sessionId);
  setConnectionQuality('connecting');
  attendanceState.textContent = 'Conectando câmera e microfone...';
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  peerConnection = connection;
  fileTransferClient.attachChannel(
    connection.createDataChannel(FILE_TRANSFER_DATA_CHANNEL_LABEL, { ordered: true }),
  );
  connection.addTransceiver('audio', { direction: 'sendrecv' });
  connection.addTransceiver('video', { direction: 'sendrecv' });
  connection.onicecandidate = (event) => {
    if (event.candidate !== null && activeWebRtcSessionId === sessionId) {
      void window.professorConnectWebRtc
        .sendIceCandidate({
          sessionId,
          candidate: serializeIceCandidate(event.candidate),
        })
        .catch(() => {
          attendanceState.textContent = 'Não foi possível enviar o ICE Candidate.';
        });
    }
  };
  connection.ontrack = (event) => {
    assignRemoteTrack(event);
  };
  connection.onconnectionstatechange = () => {
    handleWebRtcConnectionState(sessionId, connection);
  };

  try {
    isPreparingInitialMedia = true;
    await Promise.allSettled([
      mediaDeviceManager.camera.start(),
      mediaDeviceManager.microphone.start(),
    ]);
    isPreparingInitialMedia = false;
    if (activeWebRtcSessionId !== sessionId || peerConnection !== connection) {
      return;
    }
    await synchronizeLocalTracks(mediaDeviceManager.getSnapshot());
    webRtcMedia.hidden = false;
    attendanceState.textContent = 'Aluno conectado';

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    if (offer.sdp === undefined) {
      throw new Error('Offer sem SDP');
    }
    await window.professorConnectWebRtc.sendOffer({
      sessionId,
      description: { type: 'offer', sdp: offer.sdp },
    });
  } catch (error) {
    attendanceState.textContent =
      error instanceof Error ? error.message : 'Não foi possível acessar câmera e microfone.';
    closeWebRtcSession(false);
  }
}

async function handleWebRtcAnswer(
  sessionId: string,
  description: RTCSessionDescriptionInit,
): Promise<void> {
  const connection = peerConnection;
  if (connection === undefined || activeWebRtcSessionId !== sessionId) {
    return;
  }
  await connection.setRemoteDescription(description);
  await flushPendingIceCandidates(sessionId, connection);
}

async function handleWebRtcOffer(
  sessionId: string,
  description: RTCSessionDescriptionInit,
): Promise<void> {
  const connection = peerConnection;
  if (connection === undefined || activeWebRtcSessionId !== sessionId) {
    return;
  }
  await connection.setRemoteDescription(description);
  await flushPendingIceCandidates(sessionId, connection);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  if (answer.sdp === undefined) {
    throw new Error('Answer de compartilhamento sem SDP');
  }
  await window.professorConnectWebRtc.sendAnswer({
    sessionId,
    description: { type: 'answer', sdp: answer.sdp },
  });
}

function assignRemoteTrack(event: RTCTrackEvent): void {
  const stream = event.streams[0] ?? new MediaStream([event.track]);
  remoteStreams.set(stream.id, stream);
  event.track.addEventListener(
    'ended',
    () => {
      if (stream.getTracks().every((track) => track.readyState === 'ended')) {
        remoteStreams.delete(stream.id);
      }
    },
    { once: true },
  );
  const isAnnouncedScreen =
    stream.id === announcedScreenStreamId || event.track.id === announcedScreenTrackId;
  const cameraStream = remoteMediaStream;
  const isAdditionalVideo =
    event.track.kind === 'video' && cameraStream.getVideoTracks().length > 0;

  if (isAnnouncedScreen || isAdditionalVideo) {
    screenVideo.srcObject = stream;
    screenShareView.hidden = false;
    return;
  }
  if (!cameraStream.getTracks().some((track) => track.id === event.track.id)) {
    cameraStream.addTrack(event.track);
  }
  remoteVideo.srcObject = cameraStream;
}

function hideScreenShare(): void {
  if (announcedScreenStreamId !== undefined) {
    remoteStreams.delete(announcedScreenStreamId);
  }
  screenVideo.srcObject = null;
  screenVideoPlaceholder.hidden = false;
  screenShareView.hidden = true;
  announcedScreenStreamId = undefined;
  announcedScreenTrackId = undefined;
  screenStatus.textContent = 'Não compartilhando.';
  screenIndicator.dataset.indicator = 'inactive';
  dockScreenStatus.dataset.state = 'inactive';
}

async function handleRemoteIceCandidate(
  sessionId: string,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  if (activeWebRtcSessionId !== sessionId) {
    return;
  }
  const connection = peerConnection;
  if (connection === undefined || connection.remoteDescription === null) {
    const pending = pendingIceCandidates.get(sessionId) ?? [];
    if (pending.length >= MAXIMUM_PENDING_ICE_CANDIDATES) {
      pending.shift();
    }
    pending.push(candidate);
    pendingIceCandidates.set(sessionId, pending);
    return;
  }
  await connection.addIceCandidate(candidate);
}

async function flushPendingIceCandidates(
  sessionId: string,
  connection: RTCPeerConnection,
): Promise<void> {
  const candidates = pendingIceCandidates.get(sessionId) ?? [];
  pendingIceCandidates.delete(sessionId);
  for (const candidate of candidates) {
    await connection.addIceCandidate(candidate);
  }
}

function serializeIceCandidate(candidate: RTCIceCandidate) {
  const value = candidate.toJSON();
  return {
    candidate: value.candidate ?? '',
    sdpMid: value.sdpMid ?? null,
    sdpMLineIndex: value.sdpMLineIndex ?? null,
    usernameFragment: value.usernameFragment ?? null,
  };
}

function closeWebRtcSession(resetStatus = true): void {
  activeWebRtcSessionId = undefined;
  stopSessionClock();
  setConnectionQuality('idle');
  setFileDrawerOpen(false);
  pendingIceCandidates.clear();
  clearWebRtcRecovery();
  fileTransferClient.detachChannel();
  if (peerConnection !== undefined) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = undefined;
  }
  cameraSender = undefined;
  microphoneSender = undefined;
  mediaDeviceManager.camera.stop();
  mediaDeviceManager.microphone.mute();
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  for (const track of remoteMediaStream.getTracks()) {
    track.stop();
  }
  for (const stream of remoteStreams.values()) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  remoteMediaStream = new MediaStream();
  remoteVideoPlaceholder.hidden = false;
  hideScreenShare();
  remoteStreams.clear();
  renegotiationQueue = Promise.resolve();
  webRtcMedia.hidden = true;
  if (resetStatus) {
    attendanceState.textContent = 'Aluno conectado';
  }
}

function renderMediaDevices(snapshot: MediaDeviceSnapshot): void {
  cameraStatus.textContent = snapshot.camera.message;
  cameraIndicator.dataset.indicator = snapshot.camera.indicator;
  cameraButton.textContent = snapshot.camera.state === CameraState.ACTIVE ? 'Desligar' : 'Ligar';
  cameraButton.disabled = snapshot.camera.state === CameraState.NOT_FOUND;
  dockCameraButton.disabled = cameraButton.disabled;
  dockCameraButton.dataset.state =
    snapshot.camera.state === CameraState.ACTIVE ? 'active' : 'inactive';
  dockCameraButton.setAttribute(
    'aria-label',
    snapshot.camera.state === CameraState.ACTIVE ? 'Desligar câmera' : 'Ligar câmera',
  );
  dockCameraButton.setAttribute(
    'aria-pressed',
    String(snapshot.camera.state === CameraState.ACTIVE),
  );
  retryCameraButton.textContent =
    snapshot.camera.state === CameraState.NOT_FOUND ? 'Tentar novamente' : 'Ligar câmera';
  microphoneStatus.textContent = snapshot.microphone.message;
  microphoneIndicator.dataset.indicator = snapshot.microphone.indicator;
  microphoneButton.textContent =
    snapshot.microphone.state === MicrophoneState.ACTIVE ? 'Mutar' : 'Ativar';
  microphoneButton.disabled = snapshot.microphone.state === MicrophoneState.NOT_FOUND;
  dockMicrophoneButton.disabled = microphoneButton.disabled;
  dockMicrophoneButton.dataset.state =
    snapshot.microphone.state === MicrophoneState.ACTIVE ? 'active' : 'inactive';
  dockMicrophoneButton.setAttribute(
    'aria-label',
    snapshot.microphone.state === MicrophoneState.ACTIVE
      ? 'Desativar microfone'
      : 'Ativar microfone',
  );
  dockMicrophoneButton.setAttribute(
    'aria-pressed',
    String(snapshot.microphone.state === MicrophoneState.ACTIVE),
  );
  deviceScanMessage.textContent = snapshot.scanError ?? '';
  deviceScanMessage.hidden = snapshot.scanError === undefined;

  const cameraActive = snapshot.camera.state === CameraState.ACTIVE;
  localVideo.hidden = !cameraActive;
  localVideoPlaceholder.hidden =
    cameraActive && localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  localVideoPlaceholderTitle.textContent =
    snapshot.camera.state === CameraState.NOT_FOUND
      ? 'Nenhuma câmera detectada'
      : snapshot.camera.message;
}

async function synchronizeLocalTracks(snapshot: MediaDeviceSnapshot): Promise<void> {
  const connection = peerConnection;
  if (connection === undefined || connection.signalingState === 'closed') {
    return;
  }

  let changed = false;
  const cameraStream = mediaDeviceManager.camera.getStream();
  if (snapshot.camera.state === CameraState.ACTIVE && cameraStream !== undefined) {
    const track = cameraStream.getVideoTracks()[0];
    if (track !== undefined && cameraSender?.track !== track) {
      cameraSender = connection.addTrack(track, cameraStream);
      localVideo.srcObject = cameraStream;
      changed = true;
    }
  } else if (cameraSender !== undefined) {
    connection.removeTrack(cameraSender);
    cameraSender = undefined;
    localVideo.srcObject = null;
    changed = true;
  }

  const microphoneStream = mediaDeviceManager.microphone.getStream();
  if (snapshot.microphone.state === MicrophoneState.ACTIVE && microphoneStream !== undefined) {
    const track = microphoneStream.getAudioTracks()[0];
    if (track !== undefined && microphoneSender?.track !== track) {
      microphoneSender = connection.addTrack(track, microphoneStream);
      changed = true;
    }
  } else if (microphoneSender !== undefined) {
    connection.removeTrack(microphoneSender);
    microphoneSender = undefined;
    changed = true;
  }

  if (
    changed &&
    !isPreparingInitialMedia &&
    activeWebRtcSessionId !== undefined &&
    connection.signalingState === 'stable'
  ) {
    await queueRenegotiation(activeWebRtcSessionId, connection);
  }
}

function queueRenegotiation(
  sessionId: string,
  connection: RTCPeerConnection,
  iceRestart = false,
): Promise<void> {
  const next = renegotiationQueue
    .catch(() => undefined)
    .then(async () => {
      if (
        activeWebRtcSessionId !== sessionId ||
        peerConnection !== connection ||
        connection.signalingState !== 'stable'
      ) {
        return;
      }
      await renegotiateAsOfferer(sessionId, connection, iceRestart);
    });
  renegotiationQueue = next;
  return next;
}

async function renegotiateAsOfferer(
  sessionId: string,
  connection: RTCPeerConnection,
  iceRestart = false,
): Promise<void> {
  const offer = await connection.createOffer(iceRestart ? { iceRestart: true } : undefined);
  await connection.setLocalDescription(offer);
  if (offer.sdp === undefined) {
    throw new Error('Offer de mídia sem SDP');
  }
  await window.professorConnectWebRtc.sendOffer({
    sessionId,
    description: { type: 'offer', sdp: offer.sdp },
  });
}

function handleWebRtcConnectionState(sessionId: string, connection: RTCPeerConnection): void {
  if (activeWebRtcSessionId !== sessionId || peerConnection !== connection) {
    return;
  }
  if (connection.connectionState === 'connected') {
    clearWebRtcRecovery();
    setConnectionQuality('good');
    attendanceState.textContent = 'Aluno conectado';
    return;
  }
  if (connection.connectionState === 'disconnected') {
    setConnectionQuality('unstable');
    attendanceState.textContent = 'Reconectando mídia...';
    scheduleWebRtcRecovery(sessionId, connection, WEBRTC_RECOVERY_DELAY_MS);
    return;
  }
  if (connection.connectionState === 'failed') {
    setConnectionQuality('unstable');
    attendanceState.textContent = 'Recuperando conexão de mídia...';
    scheduleWebRtcRecovery(sessionId, connection, 0);
  }
}

function scheduleWebRtcRecovery(
  sessionId: string,
  connection: RTCPeerConnection,
  delayMs: number,
): void {
  if (webRtcRecoveryTimer !== undefined || webRtcRecoveryInFlight) {
    return;
  }
  webRtcRecoveryTimer = setTimeout(() => {
    webRtcRecoveryTimer = undefined;
    if (
      activeWebRtcSessionId !== sessionId ||
      peerConnection !== connection ||
      connection.connectionState === 'connected'
    ) {
      return;
    }
    if (connection.signalingState !== 'stable') {
      scheduleWebRtcRecovery(sessionId, connection, 1_000);
      return;
    }
    webRtcRecoveryInFlight = true;
    void queueRenegotiation(sessionId, connection, true)
      .catch(() => {
        attendanceState.textContent = 'Não foi possível recuperar a conexão de mídia.';
      })
      .finally(() => {
        webRtcRecoveryInFlight = false;
        if (
          activeWebRtcSessionId === sessionId &&
          peerConnection === connection &&
          (connection.connectionState === 'failed' || connection.connectionState === 'disconnected')
        ) {
          scheduleWebRtcRecovery(sessionId, connection, WEBRTC_RECOVERY_DELAY_MS);
        }
      });
  }, delayMs);
}

function clearWebRtcRecovery(): void {
  if (webRtcRecoveryTimer !== undefined) {
    clearTimeout(webRtcRecoveryTimer);
    webRtcRecoveryTimer = undefined;
  }
  webRtcRecoveryInFlight = false;
}

remoteVideo.addEventListener('loadedmetadata', () => {
  synchronizeVideoAspect(remoteVideo);
});
remoteVideo.addEventListener('resize', () => {
  synchronizeVideoAspect(remoteVideo);
});
remoteVideo.addEventListener('loadeddata', () => {
  remoteVideoPlaceholder.hidden = remoteVideo.videoWidth > 0;
});
remoteVideo.addEventListener('emptied', () => {
  remoteVideoPlaceholder.hidden = false;
});
localVideo.addEventListener('loadeddata', () => {
  synchronizeVideoAspect(localVideo);
  localVideoPlaceholder.hidden = localVideo.videoWidth > 0;
});
localVideo.addEventListener('resize', () => {
  synchronizeVideoAspect(localVideo);
});
localVideo.addEventListener('emptied', () => {
  localVideoPlaceholder.hidden = false;
});
screenVideo.addEventListener('loadeddata', () => {
  synchronizeVideoAspect(screenVideo);
  screenVideoPlaceholder.hidden = screenVideo.videoWidth > 0;
});
screenVideo.addEventListener('resize', () => {
  synchronizeVideoAspect(screenVideo);
});

type ConnectionQuality = 'idle' | 'connecting' | 'good' | 'unstable';

function setConnectionQuality(quality: ConnectionQuality): void {
  const labels: Record<ConnectionQuality, string> = {
    idle: 'Aguardando',
    connecting: 'Conectando',
    good: 'Boa',
    unstable: 'Instável',
  };
  connectionQuality.dataset.quality = quality;
  const label = connectionQuality.querySelector('span');
  if (label !== null) {
    label.textContent = labels[quality];
  }
}

function startSessionClock(sessionId: string): void {
  if (timedSessionId === sessionId && sessionClockTimer !== undefined) {
    return;
  }
  stopSessionClock();
  timedSessionId = sessionId;
  sessionStartedAt = Date.now();
  updateSessionClock();
  sessionClockTimer = setInterval(updateSessionClock, 1_000);
}

function stopSessionClock(): void {
  if (sessionClockTimer !== undefined) {
    clearInterval(sessionClockTimer);
    sessionClockTimer = undefined;
  }
  timedSessionId = undefined;
  sessionStartedAt = undefined;
  sessionDuration.textContent = '00:00';
  sessionDuration.dateTime = 'PT0S';
}

function updateSessionClock(): void {
  if (sessionStartedAt === undefined) {
    return;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1_000));
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;
  sessionDuration.textContent =
    hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  sessionDuration.dateTime = `PT${elapsedSeconds}S`;
}

function synchronizeVideoAspect(video: HTMLVideoElement): void {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }
  const tile = video.closest<HTMLElement>('.video-tile');
  tile?.style.setProperty('--video-aspect', `${video.videoWidth} / ${video.videoHeight}`);
  tile?.style.setProperty('--video-ratio', String(video.videoWidth / video.videoHeight));
}

function setFileDrawerOpen(isOpen: boolean): void {
  const canOpen = !fileTransferPanel.hidden && !dockFilesButton.disabled;
  const nextOpen = isOpen && canOpen;
  fileTransferPanel.classList.toggle('is-open', nextOpen);
  fileTransferPanel.setAttribute('aria-hidden', String(!nextOpen));
  dockFilesButton.setAttribute('aria-expanded', String(nextOpen));
}
