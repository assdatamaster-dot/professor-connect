import {
  CameraState,
  MediaDeviceManager,
  MicrophoneState,
  type MediaDeviceSnapshot,
} from './media-devices/index.js';
import {
  ProfessorPresenceStatus,
  type ProfessorPresenceSnapshot,
} from '../shared/presence-contracts.js';
import type { TeacherRemoteControlSnapshot } from '../shared/remote-control-contracts.js';
import { RemoteControlClient } from './remote-control.client.js';

const MAXIMUM_PENDING_ICE_CANDIDATES = 256;
const WEBRTC_RECOVERY_DELAY_MS = 3_000;
const loginView = requireElement<HTMLElement>('login-view');
const onlineView = requireElement<HTMLElement>('online-view');
const loginForm = requireElement<HTMLFormElement>('login-form');
const nameInput = requireElement<HTMLInputElement>('professor-name');
const loginButton = requireElement<HTMLButtonElement>('login-button');
const loginError = requireElement<HTMLElement>('login-error');
const professorDisplayName = requireElement<HTMLElement>('professor-display-name');
const presenceStatus = requireElement<HTMLElement>('presence-status');
const serverStatus = requireElement<HTMLElement>('server-status');
const logoutButton = requireElement<HTMLButtonElement>('logout-button');
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

function render(snapshot: ProfessorPresenceSnapshot): void {
  const isActive = snapshot.professorName !== undefined;

  loginView.hidden = isActive;
  onlineView.hidden = !isActive;
  loginButton.disabled = snapshot.status === ProfessorPresenceStatus.CONNECTING;

  if (!isActive) {
    remoteControlClient.stop();
    nameInput.focus();
    return;
  }

  professorDisplayName.textContent = snapshot.professorName ?? '';
  presenceStatus.textContent = getPresenceLabel(snapshot.status);
  serverStatus.textContent = snapshot.serverConnected ? 'Conectado' : 'Desconectado';
  activeAttendance.hidden = snapshot.activeSession === undefined;
  activeStudentName.textContent = snapshot.activeSession?.studentName ?? '';
  if (snapshot.activeSession === undefined) {
    closeWebRtcSession();
  } else if (activeWebRtcSessionId !== snapshot.activeSession.sessionId) {
    void startTeacherWebRtc(snapshot.activeSession.sessionId);
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
      return '🟢 Online';
    case ProfessorPresenceStatus.CONNECTING:
      return '🟡 Conectando';
    case ProfessorPresenceStatus.ERROR:
      return '🔴 Erro de conexão';
    case ProfessorPresenceStatus.DISCONNECTED:
      return '🔴 Offline';
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

  void window.professorConnectPresence.connect(nameInput.value).catch((error: unknown) => {
    loginButton.disabled = false;
    loginError.textContent = error instanceof Error ? error.message : 'Não foi possível conectar.';
    loginError.hidden = false;
  });
});

logoutButton.addEventListener('click', () => {
  logoutButton.disabled = true;
  void window.professorConnectPresence.disconnect().then((snapshot) => {
    logoutButton.disabled = false;
    nameInput.value = '';
    render(snapshot);
  });
});

acceptSessionButton.addEventListener('click', () => {
  if (activeRequestId === undefined) {
    return;
  }
  acceptSessionButton.disabled = true;
  rejectSessionButton.disabled = true;
  void window.professorConnectPresence.acceptSession(activeRequestId).finally(() => {
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
  attendanceState.textContent = 'Conectando câmera e microfone...';
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  peerConnection = connection;
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
  pendingIceCandidates.clear();
  clearWebRtcRecovery();
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
  microphoneStatus.textContent = snapshot.microphone.message;
  microphoneIndicator.dataset.indicator = snapshot.microphone.indicator;
  microphoneButton.textContent =
    snapshot.microphone.state === MicrophoneState.ACTIVE ? 'Mutar' : 'Ativar';
  microphoneButton.disabled = snapshot.microphone.state === MicrophoneState.NOT_FOUND;
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
    attendanceState.textContent = 'Aluno conectado';
    return;
  }
  if (connection.connectionState === 'disconnected') {
    attendanceState.textContent = 'Reconectando mídia...';
    scheduleWebRtcRecovery(sessionId, connection, WEBRTC_RECOVERY_DELAY_MS);
    return;
  }
  if (connection.connectionState === 'failed') {
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

remoteVideo.addEventListener('loadeddata', () => {
  remoteVideoPlaceholder.hidden = remoteVideo.videoWidth > 0;
});
remoteVideo.addEventListener('emptied', () => {
  remoteVideoPlaceholder.hidden = false;
});
localVideo.addEventListener('loadeddata', () => {
  localVideoPlaceholder.hidden = localVideo.videoWidth > 0;
});
localVideo.addEventListener('emptied', () => {
  localVideoPlaceholder.hidden = false;
});
screenVideo.addEventListener('loadeddata', () => {
  screenVideoPlaceholder.hidden = screenVideo.videoWidth > 0;
});
