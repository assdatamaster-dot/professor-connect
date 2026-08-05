import { useState, type FormEvent } from 'react';

import { ApiError, type AdminApi } from './api';
import { Spinner } from './components';
import type { Identity } from './types';
import { isValidEmail } from './validation';

export function Login({
  api,
  initialEmail = '',
  initialOrganization,
  notice,
  onAuthenticated,
}: {
  readonly api: AdminApi;
  readonly initialEmail?: string;
  readonly initialOrganization?: string;
  readonly notice?: string;
  readonly onAuthenticated: (identity: Identity) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState(initialOrganization ?? api.organizationSlug());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailError = email.length > 0 && !isValidEmail(email) ? 'Informe um e-mail válido' : null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (
      emailError !== null ||
      email.trim() === '' ||
      password === '' ||
      organization.trim() === ''
    ) {
      setError('Preencha os dados de acesso corretamente');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login(email, password, organization.trim().toLowerCase());
      onAuthenticated(result.identity);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível entrar. Verifique sua conexão e tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand" aria-label="Professor Connect">
        <div className="brand-mark brand-mark--large">
          <span>PC</span>
        </div>
        <div className="login-brand__content">
          <span className="eyebrow eyebrow--light">Professor Connect</span>
          <h1>
            Gestão simples.
            <br />
            Conexões melhores.
          </h1>
          <p>Administre sua comunidade acadêmica em um ambiente seguro, claro e integrado.</p>
        </div>
        <div className="login-orbit login-orbit--one" />
        <div className="login-orbit login-orbit--two" />
      </section>
      <section className="login-panel">
        <form className="login-card" noValidate onSubmit={(event) => void submit(event)}>
          <div className="login-card__heading">
            <span className="eyebrow">Área administrativa</span>
            <h2>Bem-vindo de volta</h2>
            <p>Use sua conta institucional para continuar.</p>
          </div>
          {notice === undefined ? null : (
            <div className="form-notice" role="status">
              {notice}
            </div>
          )}
          <label className="field">
            <span>Instituição</span>
            <input
              autoComplete="organization"
              maxLength={100}
              placeholder="identificador-da-instituicao"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="admin@instituicao.edu.br"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {emailError === null ? null : <span className="field-error">{emailError}</span>}
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              autoComplete="current-password"
              maxLength={1024}
              placeholder="Digite sua senha"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error === null ? null : (
            <div className="form-alert" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button--primary button--large"
            disabled={submitting}
            type="submit"
          >
            {submitting ? (
              <>
                <Spinner label="Entrando" /> Entrando...
              </>
            ) : (
              'Entrar no painel'
            )}
          </button>
          <p className="login-card__security">Acesso protegido e restrito a administradores.</p>
        </form>
      </section>
    </main>
  );
}
