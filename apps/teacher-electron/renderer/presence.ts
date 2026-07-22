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

const unsubscribe = window.professorConnectPresence.onStateChanged(render);
window.addEventListener('beforeunload', unsubscribe, { once: true });
void window.professorConnectPresence.getState().then(render);
