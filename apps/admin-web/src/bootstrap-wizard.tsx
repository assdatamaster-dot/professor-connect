import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import { ApiError, type AdminApi } from './api';
import { Spinner } from './components';
import type { BootstrapSetupInput, Identity } from './types';
import { createSlug, isValidEmail, validatePassword } from './validation';

const stepLabels = ['Boas-vindas', 'Instituição', 'Administrador', 'Preferências', 'Resumo'];
const states = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

const initialInput: BootstrapSetupInput = {
  organization: {
    name: '',
    tradeName: '',
    taxId: '',
    slug: '',
    city: '',
    state: '',
    country: 'BR',
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
  },
  administrator: {
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
  },
  settings: {
    systemName: 'Professor Connect',
    theme: 'system',
    language: 'pt-BR',
    defaults: { sessionDurationMinutes: 60, allowSelfRegistration: false },
  },
};

export function BootstrapWizard({
  api,
  onCompleted,
}: {
  readonly api: AdminApi;
  readonly onCompleted: (identity: Identity, theme: 'light' | 'dark' | 'system') => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [input, setInput] = useState(initialInput);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const validation = useMemo(() => validate(input), [input]);

  const updateOrganization = (
    field: keyof BootstrapSetupInput['organization'],
    value: string,
  ): void => {
    setInput((current) => ({
      ...current,
      organization: {
        ...current.organization,
        [field]: value,
        ...(field === 'name' && !slugEdited ? { slug: createSlug(value) } : {}),
      },
    }));
  };
  const updateAdministrator = (
    field: keyof BootstrapSetupInput['administrator'],
    value: string,
  ): void =>
    setInput((current) => ({
      ...current,
      administrator: { ...current.administrator, [field]: value },
    }));
  const updateSettings = (field: 'systemName' | 'language' | 'theme', value: string): void =>
    setInput((current) => ({
      ...current,
      settings: { ...current.settings, [field]: value },
    }));

  const next = (): void => {
    if (!validation.steps[step]) {
      setError('Revise os campos destacados antes de continuar.');
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, 4));
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!validation.valid) {
      setError('Revise os dados da configuração.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.bootstrapSetup(input, avatar, logo);
      onCompleted(result.identity, input.settings.theme);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const issue = caught.issues[0];
        if (issue !== undefined) {
          setStep(stepForIssue(issue.path));
          setError(issue.message);
        } else {
          setError(caught.message);
        }
      } else {
        setError('Não foi possível criar o ambiente. Nenhuma alteração foi mantida.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="bootstrap-shell">
      <aside className="bootstrap-aside">
        <div className="sidebar__brand bootstrap-brand">
          <div className="brand-mark">
            <span>PC</span>
          </div>
          <div>
            <strong>Professor</strong>
            <span>Connect</span>
          </div>
        </div>
        <div className="bootstrap-aside__copy">
          <span className="eyebrow eyebrow--light">Primeira configuração</span>
          <h1>Seu ambiente, pronto do seu jeito.</h1>
          <p>Uma configuração guiada, segura e feita apenas uma vez.</p>
        </div>
        <div className="bootstrap-aside__security">Configuração protegida por transação</div>
      </aside>
      <section className="bootstrap-workspace">
        <header className="bootstrap-progress" aria-label="Progresso da configuração">
          <div className="bootstrap-progress__track">
            <span style={{ width: `${((step + 1) / stepLabels.length) * 100}%` }} />
          </div>
          <ol>
            {stepLabels.map((label, index) => (
              <li className={index <= step ? 'is-active' : ''} key={label}>
                <span>{index + 1}</span>
                <small>{label}</small>
              </li>
            ))}
          </ol>
        </header>

        <form className="bootstrap-card" noValidate onSubmit={(event) => void submit(event)}>
          {step === 0 ? (
            <WelcomeStep />
          ) : step === 1 ? (
            <OrganizationStep
              errors={validation.errors}
              input={input}
              onChange={updateOrganization}
              onSlugChange={(value) => {
                setSlugEdited(true);
                updateOrganization('slug', createSlug(value));
              }}
            />
          ) : step === 2 ? (
            <AdministratorStep
              avatar={avatar}
              errors={validation.errors}
              input={input}
              onAvatar={(event) => setAvatar(validImage(event, setError))}
              onChange={updateAdministrator}
            />
          ) : step === 3 ? (
            <SettingsStep
              input={input}
              logo={logo}
              onChange={updateSettings}
              onDefaults={(field, value) =>
                setInput((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    defaults: { ...current.settings.defaults, [field]: value },
                  },
                }))
              }
              onLogo={(event) => setLogo(validImage(event, setError))}
            />
          ) : (
            <ReviewStep avatar={avatar} input={input} logo={logo} />
          )}

          {error === null ? null : (
            <div className="form-alert" role="alert">
              {error}
            </div>
          )}
          <footer className="bootstrap-actions">
            {step > 0 ? (
              <button
                className="button button--secondary"
                disabled={submitting}
                type="button"
                onClick={() => {
                  setError(null);
                  setStep((current) => current - 1);
                }}
              >
                Voltar
              </button>
            ) : (
              <span />
            )}
            {step < 4 ? (
              <button className="button button--primary button--large" type="button" onClick={next}>
                {step === 0 ? 'Iniciar Configuração' : 'Próximo'}
              </button>
            ) : (
              <button
                className="button button--primary button--large"
                disabled={submitting}
                type="submit"
              >
                {submitting ? (
                  <>
                    <Spinner label="Criando ambiente" /> Criando ambiente...
                  </>
                ) : (
                  'Criar Ambiente'
                )}
              </button>
            )}
          </footer>
        </form>
      </section>
    </main>
  );
}

function WelcomeStep(): React.JSX.Element {
  return (
    <section className="bootstrap-welcome">
      <span className="bootstrap-welcome__icon">01</span>
      <span className="eyebrow">Tudo começa aqui</span>
      <h2>Bem-vindo ao Professor Connect</h2>
      <p>Vamos realizar a configuração inicial do sistema.</p>
      <div className="bootstrap-feature-grid">
        <article>
          <strong>Rápido</strong>
          <span>Leva apenas alguns minutos.</span>
        </article>
        <article>
          <strong>Seguro</strong>
          <span>Todos os dados são salvos de uma só vez.</span>
        </article>
        <article>
          <strong>Definitivo</strong>
          <span>O assistente não será exibido novamente.</span>
        </article>
      </div>
    </section>
  );
}

function OrganizationStep({
  input,
  errors,
  onChange,
  onSlugChange,
}: {
  readonly input: BootstrapSetupInput;
  readonly errors: Record<string, string>;
  readonly onChange: (field: keyof BootstrapSetupInput['organization'], value: string) => void;
  readonly onSlugChange: (value: string) => void;
}): React.JSX.Element {
  const organization = input.organization;
  return (
    <Step
      title="Dados da instituição"
      description="Identifique a organização que utilizará o Professor Connect."
    >
      <div className="bootstrap-form-grid">
        <WizardField error={errors.organizationName} label="Nome da instituição" wide>
          <input
            autoFocus
            maxLength={120}
            value={organization.name}
            onChange={(event) => onChange('name', event.target.value)}
          />
        </WizardField>
        <WizardField label="Nome fantasia (opcional)">
          <input
            maxLength={120}
            value={organization.tradeName}
            onChange={(event) => onChange('tradeName', event.target.value)}
          />
        </WizardField>
        <WizardField error={errors.taxId} label="CNPJ (opcional)">
          <input
            inputMode="numeric"
            maxLength={18}
            placeholder="00.000.000/0000-00"
            value={organization.taxId}
            onChange={(event) => onChange('taxId', event.target.value)}
          />
        </WizardField>
        <WizardField
          error={errors.slug}
          hint="Gerado automaticamente; poderá ser usado no login."
          label="Identificador"
          wide
        >
          <div className="slug-field">
            <span>/</span>
            <input
              maxLength={100}
              value={organization.slug}
              onChange={(event) => onSlugChange(event.target.value)}
            />
          </div>
        </WizardField>
        <WizardField error={errors.city} label="Cidade">
          <input
            maxLength={100}
            value={organization.city}
            onChange={(event) => onChange('city', event.target.value)}
          />
        </WizardField>
        <WizardField error={errors.state} label="Estado">
          <select
            value={organization.state}
            onChange={(event) => onChange('state', event.target.value)}
          >
            <option value="">Selecione</option>
            {states.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </WizardField>
        <WizardField label="País">
          <select
            value={organization.country}
            onChange={(event) => onChange('country', event.target.value)}
          >
            <option value="BR">Brasil</option>
          </select>
        </WizardField>
        <WizardField label="Fuso horário">
          <select
            value={organization.timezone}
            onChange={(event) => onChange('timezone', event.target.value)}
          >
            <option value="America/Sao_Paulo">Brasília (UTC−03:00)</option>
            <option value="America/Manaus">Manaus (UTC−04:00)</option>
            <option value="America/Rio_Branco">Rio Branco (UTC−05:00)</option>
          </select>
        </WizardField>
        <WizardField label="Idioma">
          <select
            value={organization.language}
            onChange={(event) => onChange('language', event.target.value)}
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English</option>
            <option value="es">Español</option>
          </select>
        </WizardField>
      </div>
    </Step>
  );
}

function AdministratorStep({
  input,
  errors,
  avatar,
  onChange,
  onAvatar,
}: {
  readonly input: BootstrapSetupInput;
  readonly errors: Record<string, string>;
  readonly avatar: File | null;
  readonly onChange: (field: keyof BootstrapSetupInput['administrator'], value: string) => void;
  readonly onAvatar: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const administrator = input.administrator;
  return (
    <Step
      title="Administrador principal"
      description="Esta será a primeira conta, com acesso completo e ativação imediata."
    >
      <div className="bootstrap-upload">
        <div className="bootstrap-upload__avatar">{avatar === null ? 'AD' : '✓'}</div>
        <label>
          <strong>Foto do administrador</strong>
          <span>{avatar?.name ?? 'PNG, JPEG ou WebP — até 2 MB'}</span>
          <input accept="image/png,image/jpeg,image/webp" type="file" onChange={onAvatar} />
        </label>
      </div>
      <div className="bootstrap-form-grid">
        <WizardField error={errors.firstName} label="Nome">
          <input
            autoFocus
            maxLength={60}
            value={administrator.firstName}
            onChange={(event) => onChange('firstName', event.target.value)}
          />
        </WizardField>
        <WizardField error={errors.lastName} label="Sobrenome">
          <input
            maxLength={60}
            value={administrator.lastName}
            onChange={(event) => onChange('lastName', event.target.value)}
          />
        </WizardField>
        <WizardField error={errors.email} label="E-mail" wide>
          <input
            autoComplete="email"
            maxLength={254}
            type="email"
            value={administrator.email}
            onChange={(event) => onChange('email', event.target.value)}
          />
        </WizardField>
        <WizardField
          error={errors.password}
          hint={
            administrator.password === ''
              ? 'Mínimo de 12 caracteres, com maiúscula, número e símbolo.'
              : validatePassword(administrator.password).message
          }
          label="Senha"
        >
          <input
            autoComplete="new-password"
            maxLength={128}
            type="password"
            value={administrator.password}
            onChange={(event) => onChange('password', event.target.value)}
          />
        </WizardField>
        <WizardField error={errors.confirmPassword} label="Confirmar senha">
          <input
            autoComplete="new-password"
            maxLength={128}
            type="password"
            value={administrator.confirmPassword}
            onChange={(event) => onChange('confirmPassword', event.target.value)}
          />
        </WizardField>
        <WizardField label="Telefone (opcional)" wide>
          <input
            autoComplete="tel"
            maxLength={30}
            type="tel"
            value={administrator.phone}
            onChange={(event) => onChange('phone', event.target.value)}
          />
        </WizardField>
      </div>
    </Step>
  );
}

function SettingsStep({
  input,
  logo,
  onChange,
  onDefaults,
  onLogo,
}: {
  readonly input: BootstrapSetupInput;
  readonly logo: File | null;
  readonly onChange: (field: 'systemName' | 'language' | 'theme', value: string) => void;
  readonly onDefaults: (
    field: 'sessionDurationMinutes' | 'allowSelfRegistration',
    value: number | boolean,
  ) => void;
  readonly onLogo: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const settings = input.settings;
  return (
    <Step
      title="Preferências iniciais"
      description="Personalize a identidade e os padrões do ambiente."
    >
      <div className="bootstrap-upload">
        <div className="bootstrap-upload__logo">{logo === null ? 'PC' : '✓'}</div>
        <label>
          <strong>Logo do sistema (opcional)</strong>
          <span>{logo?.name ?? 'PNG, JPEG ou WebP — até 2 MB'}</span>
          <input accept="image/png,image/jpeg,image/webp" type="file" onChange={onLogo} />
        </label>
      </div>
      <div className="bootstrap-form-grid">
        <WizardField label="Nome do sistema" wide>
          <input
            autoFocus
            maxLength={120}
            value={settings.systemName}
            onChange={(event) => onChange('systemName', event.target.value)}
          />
        </WizardField>
        <WizardField label="Idioma">
          <select
            value={settings.language}
            onChange={(event) => onChange('language', event.target.value)}
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English</option>
            <option value="es">Español</option>
          </select>
        </WizardField>
        <WizardField label="Duração padrão do atendimento">
          <select
            value={settings.defaults.sessionDurationMinutes}
            onChange={(event) => onDefaults('sessionDurationMinutes', Number(event.target.value))}
          >
            <option value={30}>30 minutos</option>
            <option value={60}>60 minutos</option>
            <option value={90}>90 minutos</option>
            <option value={120}>120 minutos</option>
          </select>
        </WizardField>
      </div>
      <fieldset className="theme-picker">
        <legend>Tema inicial</legend>
        {(['system', 'light', 'dark'] as const).map((theme) => (
          <label className={settings.theme === theme ? 'is-selected' : ''} key={theme}>
            <input
              checked={settings.theme === theme}
              name="theme"
              type="radio"
              value={theme}
              onChange={(event) => onChange('theme', event.target.value)}
            />
            <span className={`theme-preview theme-preview--${theme}`} />
            <strong>
              {theme === 'system' ? 'Automático' : theme === 'light' ? 'Claro' : 'Escuro'}
            </strong>
          </label>
        ))}
      </fieldset>
      <label className="toggle-row">
        <input
          checked={settings.defaults.allowSelfRegistration}
          type="checkbox"
          onChange={(event) => onDefaults('allowSelfRegistration', event.target.checked)}
        />
        <span>
          <strong>Permitir autocadastro</strong>
          <small>Novos usuários poderão solicitar uma conta pela tela de acesso.</small>
        </span>
      </label>
    </Step>
  );
}

function ReviewStep({
  input,
  avatar,
  logo,
}: {
  readonly input: BootstrapSetupInput;
  readonly avatar: File | null;
  readonly logo: File | null;
}): React.JSX.Element {
  return (
    <Step
      title="Tudo pronto para começar"
      description="Confira os dados. A criação é atômica e o acesso será liberado automaticamente."
    >
      <div className="review-grid">
        <ReviewCard
          label="Instituição"
          rows={[
            [input.organization.name, input.organization.slug],
            [
              `${input.organization.city} · ${input.organization.state}`,
              input.organization.timezone,
            ],
            [input.organization.taxId || 'CNPJ não informado', input.organization.language],
          ]}
        />
        <ReviewCard
          label="Administrador"
          rows={[
            [
              `${input.administrator.firstName} ${input.administrator.lastName}`,
              'Administrador principal',
            ],
            [input.administrator.email, input.administrator.phone || 'Telefone não informado'],
            [avatar === null ? 'Sem foto' : avatar.name, 'Conta ativa imediatamente'],
          ]}
        />
        <ReviewCard
          label="Ambiente"
          rows={[
            [input.settings.systemName, `Tema ${themeName(input.settings.theme)}`],
            [logo === null ? 'Logo padrão' : logo.name, input.settings.language],
            [
              `Atendimentos de ${input.settings.defaults.sessionDurationMinutes} min`,
              input.settings.defaults.allowSelfRegistration
                ? 'Autocadastro ativo'
                : 'Autocadastro desativado',
            ],
          ]}
        />
      </div>
      <div className="bootstrap-final-note">
        <strong>Ao criar o ambiente</strong>
        <span>Você será autenticado e direcionado diretamente ao painel administrativo.</span>
      </div>
    </Step>
  );
}

function Step({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="bootstrap-step">
      <header>
        <span className="eyebrow">Configuração inicial</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function WizardField({
  label,
  error,
  hint,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={`field${wide ? ' bootstrap-field--wide' : ''}`}>
      <span>{label}</span>
      {children}
      {error === undefined ? null : <span className="field-error">{error}</span>}
      {error === undefined && hint !== undefined ? <small>{hint}</small> : null}
    </label>
  );
}

function ReviewCard({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return (
    <article className="review-card">
      <span className="eyebrow">{label}</span>
      {rows.map(([primary, secondary]) => (
        <div key={`${primary}-${secondary}`}>
          <strong>{primary}</strong>
          <small>{secondary}</small>
        </div>
      ))}
    </article>
  );
}

function validate(input: BootstrapSetupInput): {
  readonly valid: boolean;
  readonly steps: readonly boolean[];
  readonly errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (input.organization.name.trim().length < 2)
    errors.organizationName = 'Informe o nome da instituição';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.organization.slug))
    errors.slug = 'Use letras minúsculas, números e hífens';
  if (input.organization.city.trim().length < 2) errors.city = 'Informe a cidade';
  if (input.organization.state === '') errors.state = 'Selecione o estado';
  const taxId = input.organization.taxId.replace(/\D/g, '');
  if (taxId !== '' && taxId.length !== 14) errors.taxId = 'O CNPJ deve possuir 14 dígitos';
  if (input.administrator.firstName.trim().length < 2) errors.firstName = 'Informe o nome';
  if (input.administrator.lastName.trim().length < 2) errors.lastName = 'Informe o sobrenome';
  if (!isValidEmail(input.administrator.email)) errors.email = 'Informe um e-mail válido';
  const password = validatePassword(input.administrator.password);
  if (!password.valid) errors.password = password.message;
  if (input.administrator.confirmPassword !== input.administrator.password)
    errors.confirmPassword = 'As senhas não conferem';
  const organizationValid = !['organizationName', 'slug', 'city', 'state', 'taxId'].some(
    (key) => errors[key] !== undefined,
  );
  const administratorValid = ![
    'firstName',
    'lastName',
    'email',
    'password',
    'confirmPassword',
  ].some((key) => errors[key] !== undefined);
  const settingsValid = input.settings.systemName.trim().length >= 2;
  return {
    valid: organizationValid && administratorValid && settingsValid,
    steps: [true, organizationValid, administratorValid, settingsValid, true],
    errors,
  };
}

function validImage(
  event: ChangeEvent<HTMLInputElement>,
  setError: (message: string | null) => void,
): File | null {
  const file = event.target.files?.[0] ?? null;
  if (file === null) return null;
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  ) {
    event.target.value = '';
    setError('Use uma imagem PNG, JPEG ou WebP com no máximo 2 MB.');
    return null;
  }
  setError(null);
  return file;
}

function themeName(theme: 'light' | 'dark' | 'system'): string {
  return theme === 'light' ? 'claro' : theme === 'dark' ? 'escuro' : 'automático';
}

function stepForIssue(path: string): number {
  if (path.startsWith('organization.')) return 1;
  if (path.startsWith('administrator.')) return 2;
  if (path.startsWith('settings.')) return 3;
  return 4;
}
