import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, type AdminApi } from './api';
import { Avatar, EmptyState, FieldError, Modal, Spinner, TableSkeleton } from './components';
import { MoreIcon, PlusIcon, SearchIcon } from './icons';
import type { ManagedRole, ManagedUser, PaginatedUsers, UserFilters, UserStatus } from './types';
import { isValidEmail, validatePassword } from './validation';

const DEFAULT_FILTERS: UserFilters = { name: '', email: '', status: '', page: 1, pageSize: 20 };
const statusLabels: Record<UserStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  BLOCKED: 'Bloqueado',
};

type ModalState =
  | { readonly type: 'create' }
  | { readonly type: 'edit'; readonly user: ManagedUser }
  | { readonly type: 'password'; readonly user: ManagedUser }
  | { readonly type: 'delete'; readonly user: ManagedUser }
  | null;

export function UsersPage({
  api,
  role,
  notify,
}: {
  readonly api: AdminApi;
  readonly role: ManagedRole;
  readonly notify: (message: string, tone?: 'success' | 'error') => void;
}): React.JSX.Element {
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<UserFilters>(DEFAULT_FILTERS);
  const [result, setResult] = useState<PaginatedUsers | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [menuUserId, setMenuUserId] = useState<string | null>(null);
  const singular = role === 'TEACHER' ? 'professor' : 'aluno';
  const plural = role === 'TEACHER' ? 'Professores' : 'Alunos';

  useEffect(() => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setResult(null);
  }, [role]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAppliedFilters(filters), 300);
    return () => window.clearTimeout(timeout);
  }, [filters]);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setLoading(true);
      try {
        setResult(await api.listUsers(role, appliedFilters, signal));
        setLoadError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setLoadError('Não foi possível carregar os usuários. Tente novamente.');
      } finally {
        if (signal?.aborted !== true) setLoading(false);
      }
    },
    [api, appliedFilters, role],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const updateFilter = (patch: Partial<UserFilters>): void => {
    setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  };

  const statusChanged = async (user: ManagedUser, status: UserStatus): Promise<void> => {
    setMenuUserId(null);
    try {
      await api.updateStatus(user.id, status);
      notify(`${user.name} agora está ${statusLabels[status].toLowerCase()}.`);
      await load();
    } catch (caught) {
      notify(messageFrom(caught), 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-heading page-heading--actions">
        <div>
          <span className="eyebrow">Gestão de usuários</span>
          <h1>{plural}</h1>
          <p>Cadastre, encontre e gerencie todos os {plural.toLowerCase()} da instituição.</p>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => setModal({ type: 'create' })}
        >
          <PlusIcon /> Adicionar {singular}
        </button>
      </div>
      <section className="users-card">
        <div className="filters">
          <label className="search-field">
            <SearchIcon />
            <input
              aria-label="Filtrar por nome"
              placeholder="Buscar por nome..."
              value={filters.name}
              onChange={(event) => updateFilter({ name: event.target.value })}
            />
          </label>
          <label className="search-field">
            <SearchIcon />
            <input
              aria-label="Filtrar por e-mail"
              placeholder="Buscar por e-mail..."
              value={filters.email}
              onChange={(event) => updateFilter({ email: event.target.value })}
            />
          </label>
          <select
            aria-label="Filtrar por status"
            className="filter-select"
            value={filters.status}
            onChange={(event) => updateFilter({ status: event.target.value as UserStatus | '' })}
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativos</option>
            <option value="INACTIVE">Inativos</option>
            <option value="BLOCKED">Bloqueados</option>
          </select>
        </div>
        {loadError === null ? null : (
          <div className="inline-alert" role="alert">
            {loadError}
          </div>
        )}
        {loading && result === null ? (
          <TableSkeleton />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Status</th>
                  <th>Último acesso</th>
                  <th>Cadastro</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result?.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <Avatar
                          api={api}
                          hasAvatar={user.hasAvatar}
                          name={user.name}
                          userId={user.id}
                          version={user.avatarUpdatedAt}
                        />
                        <div>
                          <strong>{user.name}</strong>
                          <span>{user.email}</span>
                        </div>
                        {user.online ? (
                          <span className="online-pill">
                            <i /> Online
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge status-badge--${user.status.toLowerCase()}`}>
                        <i />
                        {statusLabels[user.status]}
                      </span>
                    </td>
                    <td>{formatDate(user.lastLoginAt)}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td className="actions-cell">
                      <button
                        aria-label={`Ações para ${user.name}`}
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          setMenuUserId((current) => (current === user.id ? null : user.id))
                        }
                      >
                        <MoreIcon />
                      </button>
                      {menuUserId === user.id ? (
                        <div className="action-menu">
                          <button
                            type="button"
                            onClick={() => {
                              setModal({ type: 'edit', user });
                              setMenuUserId(null);
                            }}
                          >
                            Editar perfil
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setModal({ type: 'password', user });
                              setMenuUserId(null);
                            }}
                          >
                            Redefinir senha
                          </button>
                          {user.status !== 'ACTIVE' ? (
                            <button
                              type="button"
                              onClick={() => void statusChanged(user, 'ACTIVE')}
                            >
                              Ativar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void statusChanged(user, 'INACTIVE')}
                            >
                              Inativar
                            </button>
                          )}
                          {user.status !== 'BLOCKED' ? (
                            <button
                              type="button"
                              onClick={() => void statusChanged(user, 'BLOCKED')}
                            >
                              Bloquear
                            </button>
                          ) : null}
                          <hr />
                          <button
                            className="danger-text"
                            type="button"
                            onClick={() => {
                              setModal({ type: 'delete', user });
                              setMenuUserId(null);
                            }}
                          >
                            Excluir
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result?.items.length === 0 ? (
              <EmptyState
                title={`Nenhum ${singular} encontrado`}
                description="Ajuste os filtros ou adicione um novo usuário."
              />
            ) : null}
          </div>
        )}
        {result !== null && result.pagination.totalItems > 0 ? (
          <div className="pagination">
            <span>
              {result.pagination.totalItems}{' '}
              {result.pagination.totalItems === 1 ? 'registro' : 'registros'}
            </span>
            <div>
              <button
                className="button button--secondary button--small"
                disabled={filters.page <= 1}
                type="button"
                onClick={() => updateFilter({ page: filters.page - 1 })}
              >
                Anterior
              </button>
              <span>
                Página {result.pagination.page} de {Math.max(1, result.pagination.totalPages)}
              </span>
              <button
                className="button button--secondary button--small"
                disabled={filters.page >= result.pagination.totalPages}
                type="button"
                onClick={() => updateFilter({ page: filters.page + 1 })}
              >
                Próxima
              </button>
            </div>
          </div>
        ) : null}
      </section>
      {modal?.type === 'create' || modal?.type === 'edit' ? (
        <UserFormModal
          api={api}
          role={role}
          user={modal.type === 'edit' ? modal.user : undefined}
          onClose={() => setModal(null)}
          onSaved={async (message) => {
            setModal(null);
            notify(message);
            await load();
          }}
        />
      ) : null}
      {modal?.type === 'password' ? (
        <PasswordModal
          api={api}
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            notify('Senha redefinida e sessões anteriores encerradas.');
          }}
        />
      ) : null}
      {modal?.type === 'delete' ? (
        <DeleteModal
          api={api}
          user={modal.user}
          onClose={() => setModal(null)}
          onDeleted={async () => {
            setModal(null);
            notify(`${modal.user.name} foi excluído.`);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function UserFormModal({
  api,
  role,
  user,
  onClose,
  onSaved,
}: {
  readonly api: AdminApi;
  readonly role: ManagedRole;
  readonly user: ManagedUser | undefined;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => Promise<void>;
}): React.JSX.Element {
  const editing = user !== undefined;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [status, setStatus] = useState<UserStatus>(user?.status ?? 'ACTIVE');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const passwordCheck = validatePassword(password);
  const nameError =
    name.trim().length > 0 && name.trim().length < 3 ? 'Informe o nome completo' : undefined;
  const emailError =
    email.length > 0 && !isValidEmail(email) ? 'Informe um e-mail válido' : undefined;

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (
      nameError !== undefined ||
      emailError !== undefined ||
      name.trim() === '' ||
      email.trim() === ''
    ) {
      setError('Revise os campos destacados.');
      return;
    }
    if (!editing && (!passwordCheck.valid || password !== confirmPassword)) {
      setError('Informe e confirme uma senha segura.');
      return;
    }
    if (avatar !== null && avatar.size > 2 * 1024 * 1024) {
      setError('A imagem deve possuir no máximo 2 MB.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await api.updateUser(user.id, { name: name.trim(), email: email.trim() })
        : await api.createUser({
            role,
            name: name.trim(),
            email: email.trim(),
            password,
            confirmPassword,
            status,
          });
      if (editing && status !== user.status) await api.updateStatus(saved.id, status);
      if (avatar !== null) await api.uploadAvatar(saved.id, avatar);
      else if (editing && removeAvatar && user.hasAvatar) await api.deleteAvatar(saved.id);
      await onSaved(
        editing
          ? 'Perfil atualizado com sucesso.'
          : `${role === 'TEACHER' ? 'Professor' : 'Aluno'} cadastrado com sucesso.`,
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Editar usuário' : `Novo ${role === 'TEACHER' ? 'professor' : 'aluno'}`}
      description={
        editing ? 'Atualize os dados, o status e a foto.' : 'Preencha os dados para criar o acesso.'
      }
      onClose={onClose}
    >
      <form className="modal-form" noValidate onSubmit={(event) => void save(event)}>
        <div className="avatar-editor">
          {editing ? (
            <Avatar
              api={api}
              hasAvatar={user.hasAvatar && !removeAvatar}
              name={name || user.name}
              size="large"
              userId={user.id}
              version={user.avatarUpdatedAt}
            />
          ) : (
            <span className="avatar avatar--large">
              {name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          )}
          <div>
            <label className="button button--secondary button--small" htmlFor="avatar-file">
              Escolher foto
            </label>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              id="avatar-file"
              type="file"
              onChange={(event) => {
                setAvatar(event.target.files?.[0] ?? null);
                setRemoveAvatar(false);
              }}
            />
            {editing && user.hasAvatar ? (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setAvatar(null);
                  setRemoveAvatar(true);
                }}
              >
                Remover foto
              </button>
            ) : null}
            <small>{avatar?.name ?? 'PNG, JPEG ou WebP · até 2 MB'}</small>
          </div>
        </div>
        <div className="form-grid">
          <label className="field field--full">
            <span>Nome completo</span>
            <input
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError message={nameError} />
          </label>
          <label className="field field--full">
            <span>E-mail</span>
            <input
              inputMode="email"
              maxLength={254}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <FieldError message={emailError} />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as UserStatus)}
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="BLOCKED">Bloqueado</option>
            </select>
          </label>
          <label className="field">
            <span>Perfil</span>
            <input disabled value={role === 'TEACHER' ? 'Professor' : 'Aluno'} />
          </label>
          {!editing ? (
            <>
              <label className="field">
                <span>Senha inicial</span>
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <FieldError message={password.length === 0 ? undefined : passwordCheck.message} />
              </label>
              <label className="field">
                <span>Confirmar senha</span>
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <FieldError
                  message={
                    confirmPassword.length > 0 && confirmPassword !== password
                      ? 'As senhas não conferem'
                      : undefined
                  }
                />
              </label>
            </>
          ) : null}
        </div>
        {error === null ? null : (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="button button--secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button button--primary" disabled={saving} type="submit">
            {saving ? (
              <>
                <Spinner /> Salvando...
              </>
            ) : (
              'Salvar'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({
  api,
  user,
  onClose,
  onSaved,
}: {
  readonly api: AdminApi;
  readonly user: ManagedUser;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const check = useMemo(() => validatePassword(password), [password]);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!check.valid || password !== confirm) {
      setError('Informe e confirme uma senha segura.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.resetPassword(user.id, password);
      onSaved();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      description={`Defina uma nova senha para ${user.name}. Todas as sessões atuais serão encerradas.`}
      title="Redefinir senha"
      width="small"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void save(event)}>
        <label className="field">
          <span>Nova senha</span>
          <input
            autoFocus
            autoComplete="new-password"
            maxLength={128}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldError message={password.length === 0 ? undefined : check.message} />
        </label>
        <label className="field">
          <span>Confirmar nova senha</span>
          <input
            autoComplete="new-password"
            maxLength={128}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <FieldError
            message={
              confirm.length > 0 && confirm !== password ? 'As senhas não conferem' : undefined
            }
          />
        </label>
        {error === null ? null : (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="button button--secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button button--primary" disabled={saving} type="submit">
            {saving ? (
              <>
                <Spinner /> Redefinindo...
              </>
            ) : (
              'Redefinir senha'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteModal({
  api,
  user,
  onClose,
  onDeleted,
}: {
  readonly api: AdminApi;
  readonly user: ManagedUser;
  readonly onClose: () => void;
  readonly onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (confirmation !== user.name) {
      setError('Digite o nome exatamente como exibido.');
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.deleteUser(user.id);
      await onDeleted();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Modal
      description="O acesso será revogado e os dados pessoais serão anonimizados. O histórico de atendimentos será preservado."
      title={`Excluir ${user.name}?`}
      width="small"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void remove(event)}>
        <div className="danger-note">Esta ação não pode ser desfeita.</div>
        <label className="field">
          <span>
            Digite <strong>{user.name}</strong> para confirmar
          </span>
          <input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error === null ? null : (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="button button--secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button button--danger"
            disabled={deleting || confirmation !== user.name}
            type="submit"
          >
            {deleting ? (
              <>
                <Spinner /> Excluindo...
              </>
            ) : (
              'Excluir usuário'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function formatDate(value: string | null): string {
  return value === null
    ? 'Nunca'
    : new Date(value).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}
function messageFrom(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Não foi possível concluir a operação.';
}
