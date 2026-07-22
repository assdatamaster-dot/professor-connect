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
let peerConnection: RTCPeerConnection | undefined;
let localStream: MediaStream | undefined;
let activeWebRtcSessionId: string | undefined;
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();

function render(snapshot: DesktopWorkflowSnapshot): void {
  const view = createDesktopViewModel(snapshot, translations);

  connectionText.textContent = view.connectionLabel;
  attendanceText.textContent = view.attendanceLabel;
  statusMessage.textContent = view.statusMessage;
  remoteControlText.textContent = view.remoteControlLabel;
  shareButton.textContent = view.screenShareLabel;
  callButton.disabled = !view.isCallButtonEnabled || teacherSelect.value.length === 0;
  shareButton.disabled = !view.isShareButtonEnabled;
  endButton.disabled = !view.isEndButtonEnabled;
  mediaSection.hidden = !view.isMediaVisible;
  callSection.hidden = !view.isCallButtonVisible;
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
  void runAction(() => window.professorConnect.shareScreen());
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
  }
  if (snapshot.status === 'ended') {
    closeWebRtcSession();
  }
});
const unsubscribeOffer = window.professorConnectWebRtc.onOffer((payload) => {
  void handleWebRtcOffer(payload.sessionId, payload.description);
});
const unsubscribeIce = window.professorConnectWebRtc.onIceCandidate((payload) => {
  void handleRemoteIceCandidate(payload.sessionId, payload.candidate).catch(() => {
    statusMessage.textContent = 'Não foi possível aplicar o ICE Candidate.';
  });
});

window.addEventListener(
  'beforeunload',
  () => {
    unsubscribe();
    unsubscribeSession();
    unsubscribeOffer();
    unsubscribeIce();
    closeWebRtcSession();
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
    const [stream] = event.streams;
    if (stream !== undefined) {
      remoteVideo.srcObject = stream;
    }
  };

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
  mediaSection.hidden = false;
  callSection.hidden = true;
  endButton.disabled = false;
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
  mediaSection.hidden = true;
  callSection.hidden = false;
  endButton.disabled = true;
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
