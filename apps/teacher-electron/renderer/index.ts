import {
  TeacherConnectionStatus,
  TeacherLogLevel,
  type TeacherWorkflowSnapshot,
} from '../shared/contracts.js';
import { getTranslations } from './i18n.js';
import { createTeacherViewModel } from './view-model.js';

const translations = getTranslations();
const connectionBadge = requireElement<HTMLElement>('connection-badge');
const connectionText = requireElement<HTMLElement>('connection-text');
const attendanceText = requireElement<HTMLElement>('attendance-text');
const statusMessage = requireElement<HTMLElement>('status-message');
const dashboardSection = requireElement<HTMLElement>('dashboard-section');
const mediaSection = requireElement<HTMLElement>('media-section');
const studentList = requireElement<HTMLUListElement>('student-list');
const requestList = requireElement<HTMLUListElement>('request-list');
const logList = requireElement<HTMLUListElement>('log-list');
const activeStudent = requireElement<HTMLElement>('active-student');
const screenStatus = requireElement<HTMLElement>('screen-status');
const remoteStatus = requireElement<HTMLElement>('remote-status');
const screenButton = requireElement<HTMLButtonElement>('request-screen-sharing');
const remoteButton = requireElement<HTMLButtonElement>('request-remote-control');
const endButton = requireElement<HTMLButtonElement>('end-attendance');

function render(snapshot: TeacherWorkflowSnapshot): void {
  const view = createTeacherViewModel(snapshot, translations);

  connectionText.textContent = view.connectionLabel;
  attendanceText.textContent = view.attendanceLabel;
  statusMessage.textContent = view.statusMessage;
  activeStudent.textContent = snapshot.activeStudentName ?? translations.remoteVideo;
  screenStatus.textContent = view.screenSharingLabel;
  remoteStatus.textContent = view.remoteControlLabel;
  dashboardSection.hidden = !view.isDashboardVisible;
  mediaSection.hidden = !view.isMediaVisible;
  screenButton.disabled = !view.canRequestScreenSharing;
  remoteButton.disabled = !view.canRequestRemoteControl;
  endButton.disabled = !view.canEndAttendance;
  connectionBadge.dataset.status = snapshot.connectionStatus;
  renderStudents(snapshot);
  renderRequests(snapshot, view.canAcceptRequests);
  renderLogs(snapshot);
}

function renderStudents(snapshot: TeacherWorkflowSnapshot): void {
  const fragment = document.createDocumentFragment();

  if (snapshot.onlineStudents.length === 0) {
    fragment.append(createEmptyItem(translations.noStudents));
  } else {
    for (const student of snapshot.onlineStudents) {
      const item = document.createElement('li');
      const identity = document.createElement('div');
      const avatar = document.createElement('span');
      const name = document.createElement('strong');
      const status = document.createElement('span');

      item.className = 'person-row';
      identity.className = 'person-row__identity';
      avatar.className = 'avatar';
      avatar.textContent = getInitials(student.displayName);
      name.textContent = student.displayName;
      status.className = 'status-chip';
      status.dataset.status = student.status;
      status.textContent = translations.studentStatus[student.status];
      identity.append(avatar, name);
      item.append(identity, status);
      fragment.append(item);
    }
  }
  studentList.replaceChildren(fragment);
}

function renderRequests(snapshot: TeacherWorkflowSnapshot, canRespond: boolean): void {
  const fragment = document.createDocumentFragment();

  if (snapshot.requests.length === 0) {
    fragment.append(createEmptyItem(translations.noRequests));
  } else {
    for (const request of snapshot.requests) {
      const item = document.createElement('li');
      const description = document.createElement('div');
      const studentName = document.createElement('strong');
      const receivedAt = document.createElement('span');
      const actions = document.createElement('div');
      const accept = createRequestButton(translations.accept, 'accept', request.requestId);
      const reject = createRequestButton(translations.reject, 'reject', request.requestId);

      item.className = 'request-row';
      description.className = 'request-row__description';
      studentName.textContent = request.studentName;
      receivedAt.textContent = `Recebida às ${formatTime(request.createdAt)}`;
      actions.className = 'request-row__actions';
      accept.classList.add('button--accept');
      reject.classList.add('button--ghost');
      accept.disabled = !canRespond;
      reject.disabled = !canRespond;
      description.append(studentName, receivedAt);
      actions.append(accept, reject);
      item.append(description, actions);
      fragment.append(item);
    }
  }
  requestList.replaceChildren(fragment);
}

function renderLogs(snapshot: TeacherWorkflowSnapshot): void {
  const fragment = document.createDocumentFragment();

  if (snapshot.logs.length === 0) {
    fragment.append(createEmptyItem(translations.noLogs));
  } else {
    for (const entry of [...snapshot.logs].reverse()) {
      const item = document.createElement('li');
      const header = document.createElement('span');
      const message = document.createElement('span');

      item.className = 'log-entry';
      if (entry.level === TeacherLogLevel.ERROR) {
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

function createRequestButton(label: string, action: string, requestId: string): HTMLButtonElement {
  const button = document.createElement('button');

  button.className = 'button button--compact';
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.requestId = requestId;
  return button;
}

function createEmptyItem(message: string): HTMLLIElement {
  const item = document.createElement('li');

  item.className = 'empty-state';
  item.textContent = message;
  return item;
}

async function runAction(action: () => Promise<TeacherWorkflowSnapshot>): Promise<void> {
  setButtonsBusy(true);
  try {
    render(await action());
  } finally {
    setButtonsBusy(false);
  }
}

function setButtonsBusy(isBusy: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-busy', String(isBusy));
  }
}

function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function requireElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Elemento obrigatório ausente: ${id}`);
  }
  return element as TElement;
}

requestList.addEventListener('click', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const requestId = target.dataset.requestId;

  if (requestId === undefined) {
    return;
  }
  if (target.dataset.action === 'accept') {
    void runAction(() => window.professorConnectTeacher.acceptRequest(requestId));
  }
  if (target.dataset.action === 'reject') {
    void runAction(() => window.professorConnectTeacher.rejectRequest(requestId));
  }
});

screenButton.addEventListener('click', () => {
  void runAction(() => window.professorConnectTeacher.requestScreenSharing());
});
remoteButton.addEventListener('click', () => {
  void runAction(() => window.professorConnectTeacher.requestRemoteControl());
});
endButton.addEventListener('click', () => {
  void runAction(() => window.professorConnectTeacher.endAttendance());
});

const unsubscribe = window.professorConnectTeacher.onStateChanged(render);

window.addEventListener('beforeunload', unsubscribe, { once: true });
void window.professorConnectTeacher
  .initialize()
  .then(render)
  .catch(() => {
    connectionBadge.dataset.status = TeacherConnectionStatus.ERROR;
    connectionText.textContent = translations.connection[TeacherConnectionStatus.ERROR];
    statusMessage.textContent = 'Não foi possível inicializar o aplicativo.';
  });
