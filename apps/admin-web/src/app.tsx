import { useEffect, useState } from 'react';

import { AdminApi } from './api';
import { BootstrapWizard } from './bootstrap-wizard';
import { Dashboard } from './dashboard';
import { Avatar } from './components';
import { GraduationIcon, GridIcon, LogoutIcon, MoonIcon, SunIcon, UsersIcon } from './icons';
import { Login } from './login';
import type { Identity, ManagedRole } from './types';
import { UsersPage } from './users-page';

type View = 'dashboard' | 'teachers' | 'students';
interface LoginHandoff {
  readonly email: string;
  readonly organizationSlug: string;
}
const api = new AdminApi();

export function App(): React.JSX.Element {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [loginHandoff, setLoginHandoff] = useState<LoginHandoff | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => viewFromHash());
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('professor-connect.admin.theme') === 'dark' ? 'dark' : 'light',
  );
  const [toast, setToast] = useState<{
    readonly message: string;
    readonly tone: 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('professor-connect.admin.theme', theme);
  }, [theme]);

  useEffect(() => {
    void api
      .bootstrapStatus()
      .then(async (status) => {
        if (!status.initialized) {
          setBootstrapRequired(true);
          return;
        }
        const result = await api.restore();
        setIdentity(result?.identity ?? null);
      })
      .catch(() => setStartupError('Não foi possível verificar a configuração do servidor.'))
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setView(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (toast === null) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const navigate = (next: View): void => {
    window.location.hash = next;
    setView(next);
  };
  const notify = (message: string, tone: 'success' | 'error' = 'success'): void =>
    setToast({ message, tone });

  if (restoring) {
    return (
      <div className="app-loading">
        <div className="brand-mark">
          <span>PC</span>
        </div>
        <span>Preparando seu painel...</span>
      </div>
    );
  }
  if (startupError !== null) {
    return (
      <div className="app-loading app-loading--error" role="alert">
        <div className="brand-mark">
          <span>PC</span>
        </div>
        <strong>Não foi possível iniciar o painel</strong>
        <span>{startupError}</span>
        <button
          className="button button--primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }
  if (bootstrapRequired) {
    return (
      <BootstrapWizard
        api={api}
        onAlreadyConfigured={(handoff) => {
          setLoginHandoff(handoff);
          setBootstrapRequired(false);
          setIdentity(null);
        }}
        onCompleted={(authenticatedIdentity, selectedTheme) => {
          const resolvedTheme =
            selectedTheme === 'system'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
              : selectedTheme;
          setTheme(resolvedTheme);
          setBootstrapRequired(false);
          setIdentity(authenticatedIdentity);
          window.location.hash = 'dashboard';
        }}
      />
    );
  }
  if (identity === null) {
    return (
      <Login
        api={api}
        {...(loginHandoff === null
          ? {}
          : {
              initialEmail: loginHandoff.email,
              initialOrganization: loginHandoff.organizationSlug,
              notice: 'Este ambiente já foi configurado. Entre com a conta administrativa criada.',
            })}
        onAuthenticated={setIdentity}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="brand-mark">
            <span>PC</span>
          </div>
          <div>
            <strong>Professor</strong>
            <span>Connect</span>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          <span className="nav-label">Principal</span>
          <NavButton
            active={view === 'dashboard'}
            icon={<GridIcon />}
            label="Dashboard"
            onClick={() => navigate('dashboard')}
          />
          <span className="nav-label">Pessoas</span>
          <NavButton
            active={view === 'teachers'}
            icon={<UsersIcon />}
            label="Professores"
            onClick={() => navigate('teachers')}
          />
          <NavButton
            active={view === 'students'}
            icon={<GraduationIcon />}
            label="Alunos"
            onClick={() => navigate('students')}
          />
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__version">Professor Connect · Beta</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__context">
            <span>Administração</span>
            <i>/</i>
            <strong>
              {view === 'dashboard'
                ? 'Visão geral'
                : view === 'teachers'
                  ? 'Professores'
                  : 'Alunos'}
            </strong>
          </div>
          <div className="topbar__actions">
            <button
              aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}
              className="icon-button"
              type="button"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <div className="topbar__profile">
              <Avatar
                api={api}
                hasAvatar={false}
                name={identity.displayName}
                size="small"
                userId={identity.userId}
              />
              <div>
                <strong>{identity.displayName}</strong>
                <span>Administrador</span>
              </div>
            </div>
            <button
              aria-label="Sair"
              className="icon-button"
              type="button"
              onClick={() => void api.logout().finally(() => setIdentity(null))}
            >
              <LogoutIcon />
            </button>
          </div>
        </header>
        <main className="content">
          {view === 'dashboard' ? (
            <Dashboard api={api} />
          ) : (
            <UsersPage api={api} notify={notify} role={roleForView(view)} />
          )}
        </main>
      </div>
      {toast === null ? null : (
        <div className={`toast toast--${toast.tone}`} role="status">
          <i />
          {toast.message}
        </div>
      )}
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={active ? 'nav-button nav-button--active' : 'nav-button'}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function viewFromHash(): View {
  const value = window.location.hash.slice(1);
  return value === 'teachers' || value === 'students' ? value : 'dashboard';
}

function roleForView(view: Exclude<View, 'dashboard'>): ManagedRole {
  return view === 'teachers' ? 'TEACHER' : 'STUDENT';
}
