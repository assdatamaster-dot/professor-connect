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
});

window.addEventListener(
  'beforeunload',
  () => {
    unsubscribe();
    unsubscribeSession();
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
