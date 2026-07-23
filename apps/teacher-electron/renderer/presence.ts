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

function render(snapshot: ProfessorPresenceSnapshot): void {
  const isActive = snapshot.professorName !== undefined;

  loginView.hidden = isActive;
  onlineView.hidden = !isActive;
  loginButton.disabled = snapshot.status === ProfessorPresenceStatus.CONNECTING;

  if (!isActive) {
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
  renderSessionRequest(snapshot);
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
  const connection = peerConnection;
  if (
    connection === undefined ||
    activeWebRtcSessionId !== sessionId ||
    connection.remoteDescription === null
  ) {
    const pending = pendingIceCandidates.get(sessionId) ?? [];
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
  const sessionId = activeWebRtcSessionId;
  activeWebRtcSessionId = undefined;
  if (sessionId !== undefined) {
    pendingIceCandidates.delete(sessionId);
  }
  if (peerConnection !== undefined) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.close();
    peerConnection = undefined;
  }
  cameraSender = undefined;
  microphoneSender = undefined;
  mediaDeviceManager.camera.stop();
  mediaDeviceManager.microphone.mute();
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remoteMediaStream = new MediaStream();
  remoteVideoPlaceholder.hidden = false;
  hideScreenShare();
  remoteStreams.clear();
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

function queueRenegotiation(sessionId: string, connection: RTCPeerConnection): Promise<void> {
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
      await renegotiateAsOfferer(sessionId, connection);
    });
  renegotiationQueue = next;
  return next;
}

async function renegotiateAsOfferer(
  sessionId: string,
  connection: RTCPeerConnection,
): Promise<void> {
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  if (offer.sdp === undefined) {
    throw new Error('Offer de mídia sem SDP');
  }
  await window.professorConnectWebRtc.sendOffer({
    sessionId,
    description: { type: 'offer', sdp: offer.sdp },
  });
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
