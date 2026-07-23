import {
  CameraState,
  MediaDeviceManager,
  MicrophoneState,
  ScreenShareState,
  type MediaDeviceSnapshot,
} from './media-devices/index.js';
import {
  DesktopConnectionStatus,
  DesktopLogLevel,
  type DesktopWorkflowSnapshot,
} from '../shared/contracts.js';
import { getTranslations } from './i18n.js';
import { createDesktopViewModel } from './view-model.js';

const translations = getTranslations();
const connectionBadge = requireElement<HTMLElement>('connection-badge');
const connectionText = requireElement<HTMLElement>('connection-text');
const attendanceText = requireElement<HTMLElement>('attendance-text');
const statusMessage = requireElement<HTMLElement>('status-message');
const remoteControlText = requireElement<HTMLElement>('remote-control-text');
const callButton = requireElement<HTMLButtonElement>('call-professor');
const teacherSelect = requireElement<HTMLSelectElement>('teacher-select');
const shareButton = requireElement<HTMLButtonElement>('share-screen');
const endButton = requireElement<HTMLButtonElement>('end-attendance');
const mediaSection = requireElement<HTMLElement>('media-section');
const callSection = requireElement<HTMLElement>('call-section');
const logList = requireElement<HTMLUListElement>('log-list');
const localVideo = requireElement<HTMLVideoElement>('local-video');
const remoteVideo = requireElement<HTMLVideoElement>('remote-video');
const localVideoPlaceholder = requireElement<HTMLElement>('local-video-placeholder');
const localVideoPlaceholderTitle = requireElement<HTMLElement>('local-video-placeholder-title');
const remoteVideoPlaceholder = requireElement<HTMLElement>('remote-video-placeholder');
const cameraStatus = requireElement<HTMLElement>('camera-status');
const cameraIndicator = requireElement<HTMLElement>('camera-indicator');
const cameraButton = requireElement<HTMLButtonElement>('toggle-camera');
const microphoneStatus = requireElement<HTMLElement>('microphone-status');
const microphoneIndicator = requireElement<HTMLElement>('microphone-indicator');
const microphoneButton = requireElement<HTMLButtonElement>('toggle-microphone');
const screenStatus = requireElement<HTMLElement>('screen-status');
const screenIndicator = requireElement<HTMLElement>('screen-indicator');
const deviceScanMessage = requireElement<HTMLElement>('device-scan-message');
const mediaDeviceManager = new MediaDeviceManager();
let peerConnection: RTCPeerConnection | undefined;
let cameraSender: RTCRtpSender | undefined;
let microphoneSender: RTCRtpSender | undefined;
let screenSender: RTCRtpSender | undefined;
let isStoppingScreenShare = false;
let isPreparingInitialMedia = false;
let lastMediaSnapshot: MediaDeviceSnapshot | undefined;
let activeWebRtcSessionId: string | undefined;
let remoteMediaStream = new MediaStream();
let renegotiationQueue = Promise.resolve();
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();

function render(snapshot: DesktopWorkflowSnapshot): void {
  const view = createDesktopViewModel(snapshot, translations);

  connectionText.textContent = view.connectionLabel;
  attendanceText.textContent = view.attendanceLabel;
  statusMessage.textContent = view.statusMessage;
  remoteControlText.textContent = view.remoteControlLabel;
  callButton.disabled = !view.isCallButtonEnabled || teacherSelect.value.length === 0;
  shareButton.disabled = activeWebRtcSessionId === undefined && !view.isShareButtonEnabled;
  endButton.disabled = !view.isEndButtonEnabled;
  const hasActiveWebRtcSession = activeWebRtcSessionId !== undefined;
  mediaSection.hidden = !hasActiveWebRtcSession && !view.isMediaVisible;
  callSection.hidden = hasActiveWebRtcSession || !view.isCallButtonVisible;
  connectionBadge.dataset.status = snapshot.connectionStatus;
  renderLogs(snapshot);
}

function renderLogs(snapshot: DesktopWorkflowSnapshot): void {
  const fragment = document.createDocumentFragment();

  if (snapshot.logs.length === 0) {
    const empty = document.createElement('li');

    empty.className = 'log-empty';
    empty.textContent = translations.noLogs;
    fragment.append(empty);
  } else {
    for (const entry of [...snapshot.logs].reverse()) {
      const item = document.createElement('li');
      const header = document.createElement('span');
      const message = document.createElement('span');

      item.className = 'log-entry';
      if (entry.level === DesktopLogLevel.ERROR) {
        item.classList.add('log-entry--error');
      }
      header.className = 'log-entry__header';
      header.textContent = `${formatTime(entry.timestamp)} · ${entry.category}`;
      message.textContent = entry.message;
      item.append(header, message);
      fragment.append(item);
    }
  }

  logList.replaceChildren(fragment);
}

async function runAction(action: () => Promise<DesktopWorkflowSnapshot>): Promise<void> {
  setButtonsBusy(true);
  try {
    render(await action());
  } finally {
    setButtonsBusy(false);
  }
}

function setButtonsBusy(isBusy: boolean): void {
  callButton.setAttribute('aria-busy', String(isBusy));
  shareButton.setAttribute('aria-busy', String(isBusy));
  endButton.setAttribute('aria-busy', String(isBusy));
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function requireElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Elemento obrigatório ausente: ${id}`);
  }
  return element as TElement;
}

callButton.addEventListener('click', () => {
  callButton.disabled = true;
  teacherSelect.disabled = true;
  void window.professorConnectSession
    .requestSession(teacherSelect.value)
    .catch((error: unknown) => {
      statusMessage.textContent =
        error instanceof Error ? error.message : 'Não foi possível solicitar atendimento.';
      callButton.disabled = teacherSelect.value.length === 0;
      teacherSelect.disabled = false;
    });
});
shareButton.addEventListener('click', () => {
  if (activeWebRtcSessionId === undefined) {
    void runAction(() => window.professorConnect.shareScreen());
    return;
  }
  shareButton.disabled = true;
  if (mediaDeviceManager.screenShare.getStatus().state !== ScreenShareState.SHARING) {
    screenStatus.textContent = 'Aguardando seleção da tela...';
    screenIndicator.dataset.indicator = 'pending';
  }
  const action =
    mediaDeviceManager.screenShare.getStatus().state === ScreenShareState.SHARING
      ? stopScreenShare(true)
      : startScreenShare();
  void action
    .catch((error: unknown) => {
      statusMessage.textContent =
        error instanceof Error ? error.message : 'Não foi possível alterar o compartilhamento.';
    })
    .finally(() => {
      shareButton.disabled = activeWebRtcSessionId === undefined;
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
endButton.addEventListener('click', () => {
  if (activeWebRtcSessionId !== undefined) {
    endButton.disabled = true;
    void window.professorConnectSession.endSession().catch(() => {
      endButton.disabled = false;
    });
    return;
  }
  void runAction(() => window.professorConnect.endAttendance());
});

const unsubscribe = window.professorConnect.onStateChanged(render);
const unsubscribeSession = window.professorConnectSession.onStateChanged((snapshot) => {
  statusMessage.textContent = snapshot.message;
  const isSessionBusy =
    snapshot.status === 'waiting' ||
    snapshot.status === 'accepted' ||
    snapshot.status === 'connected';
  callButton.disabled = isSessionBusy || teacherSelect.value.length === 0;
  teacherSelect.disabled = isSessionBusy;
  if (snapshot.status === 'connected') {
    endButton.disabled = false;
    mediaSection.hidden = false;
    callSection.hidden = true;
  }
  if (snapshot.status === 'ended') {
    closeWebRtcSession();
  }
});
const unsubscribeOffer = window.professorConnectWebRtc.onOffer((payload) => {
  void handleWebRtcOffer(payload.sessionId, payload.description);
});
const unsubscribeAnswer = window.professorConnectWebRtc.onAnswer((payload) => {
  void handleWebRtcAnswer(payload.sessionId, payload.description).catch(() => {
    statusMessage.textContent = 'Não foi possível aplicar a resposta WebRTC.';
  });
});
const unsubscribeIce = window.professorConnectWebRtc.onIceCandidate((payload) => {
  void handleRemoteIceCandidate(payload.sessionId, payload.candidate).catch(() => {
    statusMessage.textContent = 'Não foi possível aplicar o ICE Candidate.';
  });
});
const unsubscribeMediaDevices = mediaDeviceManager.subscribe((snapshot) => {
  renderMediaDevices(snapshot);
  void synchronizeLocalTracks(snapshot).catch(() => {
    statusMessage.textContent = 'Não foi possível atualizar os dispositivos da sessão.';
  });
});

window.addEventListener(
  'beforeunload',
  () => {
    unsubscribe();
    unsubscribeSession();
    unsubscribeOffer();
    unsubscribeAnswer();
    unsubscribeIce();
    unsubscribeMediaDevices();
    closeWebRtcSession();
    mediaDeviceManager.dispose();
  },
  { once: true },
);
void window.professorConnectSession
  .getOnlineTeachers()
  .then((teachers) => {
    const options = teachers.map((teacher) => {
      const option = document.createElement('option');

      option.value = teacher.id;
      option.textContent = teacher.name;
      return option;
    });
    const placeholder = document.createElement('option');

    placeholder.value = '';
    placeholder.textContent =
      teachers.length > 0 ? 'Selecione um professor' : 'Nenhum professor online';
    teacherSelect.replaceChildren(placeholder, ...options);
    callButton.disabled = true;
  })
  .catch(() => {
    const option = document.createElement('option');

    option.value = '';
    option.textContent = 'Não foi possível carregar professores';
    teacherSelect.replaceChildren(option);
    callButton.disabled = true;
  });
teacherSelect.addEventListener('change', () => {
  callButton.disabled = teacherSelect.value.length === 0;
});
void window.professorConnect
  .initialize()
  .then(render)
  .catch(() => {
    connectionBadge.dataset.status = DesktopConnectionStatus.ERROR;
    connectionText.textContent = translations.connection[DesktopConnectionStatus.ERROR];
    statusMessage.textContent = 'Não foi possível inicializar o aplicativo.';
  });
void mediaDeviceManager.initialize();

async function handleWebRtcOffer(
  sessionId: string,
  description: RTCSessionDescriptionInit,
): Promise<void> {
  try {
    if (activeWebRtcSessionId !== sessionId || peerConnection === undefined) {
      closeWebRtcSession();
      await createStudentPeerConnection(sessionId);
    }
    const connection = peerConnection;
    if (connection === undefined || activeWebRtcSessionId !== sessionId) {
      return;
    }

    await connection.setRemoteDescription(description);
    await flushPendingIceCandidates(sessionId, connection);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    if (answer.sdp === undefined) {
      throw new Error('Answer sem SDP');
    }
    await window.professorConnectWebRtc.sendAnswer({
      sessionId,
      description: { type: 'answer', sdp: answer.sdp },
    });
    shareButton.disabled = false;
  } catch (error) {
    statusMessage.textContent =
      error instanceof Error ? error.message : 'Não foi possível iniciar áudio e vídeo.';
    closeWebRtcSession();
  }
}

async function createStudentPeerConnection(sessionId: string): Promise<void> {
  activeWebRtcSessionId = sessionId;
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
          statusMessage.textContent = 'Não foi possível enviar o ICE Candidate.';
        });
    }
  };
  connection.ontrack = (event) => {
    if (!remoteMediaStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteMediaStream.addTrack(event.track);
    }
    remoteVideo.srcObject = remoteMediaStream;
  };

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
  mediaSection.hidden = false;
  callSection.hidden = true;
  endButton.disabled = false;
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

async function startScreenShare(): Promise<void> {
  const sessionId = activeWebRtcSessionId;
  const connection = peerConnection;
  if (
    sessionId === undefined ||
    connection === undefined ||
    mediaDeviceManager.screenShare.getStatus().state === ScreenShareState.SHARING
  ) {
    return;
  }
  if (connection.signalingState !== 'stable') {
    throw new Error('A conexão ainda está sendo preparada. Tente novamente.');
  }

  let professorWasNotified = false;
  try {
    const stream = await mediaDeviceManager.screenShare.start();
    if (stream === undefined) {
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (track === undefined) {
      mediaDeviceManager.screenShare.stop();
      return;
    }
    if (activeWebRtcSessionId !== sessionId || peerConnection !== connection) {
      mediaDeviceManager.screenShare.stop();
      return;
    }

    screenSender = connection.addTrack(track, stream);
    statusMessage.textContent = 'Compartilhando tela com o professor.';
    await window.professorConnectWebRtc.sendScreenShareStart({
      sessionId,
      streamId: stream.id,
      trackId: track.id,
    });
    professorWasNotified = true;
    await queueRenegotiation(sessionId, connection);
  } catch (error) {
    cleanupScreenShare(connection, true);
    if (professorWasNotified && activeWebRtcSessionId === sessionId) {
      await window.professorConnectWebRtc.sendScreenShareStop({ sessionId }).catch(() => undefined);
    }
    statusMessage.textContent =
      error instanceof Error ? error.message : 'Não foi possível compartilhar a tela.';
  }
}

async function stopScreenShare(notifyProfessor: boolean): Promise<void> {
  if (isStoppingScreenShare) {
    return;
  }
  const sessionId = activeWebRtcSessionId;
  const connection = peerConnection;
  if (mediaDeviceManager.screenShare.getStream() === undefined && screenSender === undefined) {
    return;
  }

  isStoppingScreenShare = true;
  try {
    cleanupScreenShare(connection, true);
    if (notifyProfessor && sessionId !== undefined) {
      await window.professorConnectWebRtc.sendScreenShareStop({ sessionId });
    }
    if (
      sessionId !== undefined &&
      connection !== undefined &&
      connection.signalingState === 'stable'
    ) {
      await queueRenegotiation(sessionId, connection);
    }
    statusMessage.textContent = 'Compartilhamento de tela encerrado.';
  } finally {
    isStoppingScreenShare = false;
  }
}

function cleanupScreenShare(connection = peerConnection, stopCapture = false): void {
  if (screenSender !== undefined && connection?.signalingState !== 'closed') {
    connection?.removeTrack(screenSender);
  }
  screenSender = undefined;
  if (stopCapture) {
    mediaDeviceManager.screenShare.stop();
  }
}

async function renegotiateAsOfferer(
  sessionId: string,
  connection: RTCPeerConnection,
): Promise<void> {
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  if (offer.sdp === undefined) {
    throw new Error('Offer de compartilhamento sem SDP');
  }
  await window.professorConnectWebRtc.sendOffer({
    sessionId,
    description: { type: 'offer', sdp: offer.sdp },
  });
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

function closeWebRtcSession(): void {
  const sessionId = activeWebRtcSessionId;
  activeWebRtcSessionId = undefined;
  if (sessionId !== undefined) {
    pendingIceCandidates.delete(sessionId);
  }
  if (peerConnection !== undefined) {
    cleanupScreenShare(peerConnection, true);
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
  mediaSection.hidden = true;
  callSection.hidden = false;
  endButton.disabled = true;
  shareButton.disabled = true;
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
  screenStatus.textContent = snapshot.screenShare.message;
  screenIndicator.dataset.indicator = snapshot.screenShare.indicator;
  shareButton.textContent =
    snapshot.screenShare.state === ScreenShareState.SHARING
      ? 'Parar Compartilhamento'
      : 'Compartilhar Tela';
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
  const previous = lastMediaSnapshot;
  lastMediaSnapshot = snapshot;
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
    previous?.screenShare.state === ScreenShareState.SHARING &&
    snapshot.screenShare.state === ScreenShareState.STOPPED &&
    screenSender !== undefined &&
    !isStoppingScreenShare
  ) {
    await stopScreenShare(true);
    return;
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
