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
const sessionDialog = requireElement<HTMLDialogElement>('session-request-dialog');
const requestStudentName = requireElement<HTMLElement>('request-student-name');
const acceptSessionButton = requireElement<HTMLButtonElement>('accept-session');
const rejectSessionButton = requireElement<HTMLButtonElement>('reject-session');
let activeRequestId: string | undefined;
let peerConnection: RTCPeerConnection | undefined;
let localStream: MediaStream | undefined;
let activeWebRtcSessionId: string | undefined;
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const remoteStreams = new Map<string, MediaStream>();
let announcedScreenStreamId: string | undefined;
let announcedScreenTrackId: string | undefined;

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
    attendanceState.textContent = 'Tela compartilhada';
  },
);
const unsubscribeScreenShareStopped = window.professorConnectWebRtc.onScreenShareStopped(
  (payload) => {
    if (payload.sessionId === activeWebRtcSessionId) {
      hideScreenShare();
      attendanceState.textContent = 'Aluno conectado';
    }
  },
);
window.addEventListener(
  'beforeunload',
  () => {
    unsubscribe();
    unsubscribeAnswer();
    unsubscribeOffer();
    unsubscribeIce();
    unsubscribeScreenShareStarted();
    unsubscribeScreenShareStopped();
    closeWebRtcSession();
  },
  { once: true },
);
void window.professorConnectPresence.getState().then(render);

async function startTeacherWebRtc(sessionId: string): Promise<void> {
  closeWebRtcSession();
  activeWebRtcSessionId = sessionId;
  attendanceState.textContent = 'Conectando câmera e microfone...';
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  peerConnection = connection;
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
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (activeWebRtcSessionId !== sessionId || peerConnection !== connection) {
      stopMediaStream(stream);
      return;
    }
    localStream = stream;
    localVideo.srcObject = stream;
    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
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
  const cameraStream = remoteVideo.srcObject;
  const isAdditionalVideo =
    event.track.kind === 'video' &&
    cameraStream instanceof MediaStream &&
    cameraStream.id !== stream.id;

  if (isAnnouncedScreen || isAdditionalVideo) {
    screenVideo.srcObject = stream;
    screenShareView.hidden = false;
    return;
  }
  remoteVideo.srcObject = stream;
}

function hideScreenShare(): void {
  screenVideo.srcObject = null;
  screenShareView.hidden = true;
  announcedScreenStreamId = undefined;
  announcedScreenTrackId = undefined;
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
  if (localStream !== undefined) {
    stopMediaStream(localStream);
    localStream = undefined;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  hideScreenShare();
  remoteStreams.clear();
  webRtcMedia.hidden = true;
  if (resetStatus) {
    attendanceState.textContent = 'Aluno conectado';
  }
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
