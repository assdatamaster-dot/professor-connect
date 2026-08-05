import type {
  AuthResponse,
  BootstrapSetupInput,
  BootstrapSetupResult,
  BootstrapStatus,
  DashboardMetrics,
  ManagedRole,
  ManagedUser,
  PaginatedUsers,
  UserFilters,
  UserStatus,
} from './types';

const REFRESH_TOKEN_KEY = 'professor-connect.admin.refresh-token';
const ORGANIZATION_KEY = 'professor-connect.admin.organization';

export interface ApiIssue {
  readonly path: string;
  readonly message: string;
}

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly issues: readonly ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AdminApi {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponse> | null = null;

  public bootstrapStatus(): Promise<BootstrapStatus> {
    return this.publicRequest('/api/bootstrap/status');
  }

  public async bootstrapSetup(
    input: BootstrapSetupInput,
    adminAvatar: File | null,
    logo: File | null,
  ): Promise<BootstrapSetupResult> {
    const body = new FormData();
    body.append('payload', JSON.stringify(input));
    if (adminAvatar !== null) body.append('adminAvatar', adminAvatar);
    if (logo !== null) body.append('logo', logo);
    const result = await this.publicRequest<BootstrapSetupResult>('/api/bootstrap/setup', {
      method: 'POST',
      body,
    });
    this.acceptSession(result, result.organization.slug);
    return result;
  }

  public async login(
    email: string,
    password: string,
    organizationSlug: string,
  ): Promise<AuthResponse> {
    const result = await this.publicRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, organizationSlug }),
    });
    this.acceptSession(result, organizationSlug);
    return result;
  }

  public async restore(): Promise<AuthResponse | null> {
    if (localStorage.getItem(REFRESH_TOKEN_KEY) === null) return null;
    try {
      return await this.refresh();
    } catch {
      this.clearSession();
      return null;
    }
  }

  public async logout(): Promise<void> {
    try {
      if (this.accessToken !== null) {
        await this.request('/api/auth/logout', { method: 'POST' }, false);
      }
    } finally {
      this.clearSession();
    }
  }

  public organizationSlug(): string {
    return localStorage.getItem(ORGANIZATION_KEY) ?? 'professor-connect';
  }

  public dashboard(signal?: AbortSignal): Promise<DashboardMetrics> {
    return this.request('/api/admin/dashboard', signal === undefined ? {} : { signal });
  }

  public listUsers(
    role: ManagedRole,
    filters: UserFilters,
    signal?: AbortSignal,
  ): Promise<PaginatedUsers> {
    const parameters = new URLSearchParams({
      role,
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.name !== '') parameters.set('name', filters.name);
    if (filters.email !== '') parameters.set('email', filters.email);
    if (filters.status !== '') parameters.set('status', filters.status);
    return this.request(
      `/api/admin/users?${parameters.toString()}`,
      signal === undefined ? {} : { signal },
    );
  }

  public createUser(input: {
    role: ManagedRole;
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    status: UserStatus;
  }): Promise<ManagedUser> {
    return this.request('/api/admin/users', jsonRequest('POST', input));
  }

  public updateUser(userId: string, input: { name: string; email: string }): Promise<ManagedUser> {
    return this.request(`/api/admin/users/${userId}`, jsonRequest('PUT', input));
  }

  public updateStatus(userId: string, status: UserStatus): Promise<ManagedUser> {
    return this.request(`/api/admin/users/${userId}/status`, jsonRequest('PUT', { status }));
  }

  public resetPassword(userId: string, newPassword: string): Promise<void> {
    return this.request(
      `/api/admin/users/${userId}/reset-password`,
      jsonRequest('POST', { newPassword, confirmPassword: newPassword }),
    );
  }

  public deleteUser(userId: string): Promise<void> {
    return this.request(`/api/admin/users/${userId}`, { method: 'DELETE' });
  }

  public async uploadAvatar(userId: string, file: File): Promise<void> {
    const body = new FormData();
    body.append('avatar', file);
    await this.request(`/api/admin/users/${userId}/avatar`, { method: 'POST', body });
  }

  public deleteAvatar(userId: string): Promise<void> {
    return this.request(`/api/admin/users/${userId}/avatar`, { method: 'DELETE' });
  }

  public async avatarUrl(userId: string, signal?: AbortSignal): Promise<string> {
    const response = await this.authorizedFetch(
      `/api/admin/users/${userId}/avatar`,
      signal === undefined ? {} : { signal },
    );
    if (!response.ok) throw await this.toError(response);
    return URL.createObjectURL(await response.blob());
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const response = await this.authorizedFetch(path, init);
    if (response.status === 401 && retry) {
      await this.refresh();
      return this.request(path, init, false);
    }
    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.accessToken !== null) headers.set('Authorization', `Bearer ${this.accessToken}`);
    return fetch(path, { ...init, headers });
  }

  private refresh(): Promise<AuthResponse> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken === null) return Promise.reject(new Error('Sessão ausente'));
    this.refreshPromise = this.publicRequest<AuthResponse>('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then((result) => {
        this.acceptSession(result, this.organizationSlug());
        return result;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, init);
    if (!response.ok) throw await this.toError(response);
    return (await response.json()) as T;
  }

  private acceptSession(result: AuthResponse, organizationSlug: string): void {
    if (!result.identity.roles.includes('ADMIN')) {
      this.clearSession();
      throw new ApiError('Acesso exclusivo para administradores', 403, 'admin_required');
    }
    this.accessToken = result.tokens.accessToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, result.tokens.refreshToken);
    localStorage.setItem(ORGANIZATION_KEY, organizationSlug);
  }

  private clearSession(): void {
    this.accessToken = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  private async toError(response: Response): Promise<ApiError> {
    const fallback = 'Não foi possível concluir a operação';
    try {
      const body = (await response.json()) as {
        message?: unknown;
        code?: unknown;
        issues?: unknown;
      };
      return new ApiError(
        typeof body.message === 'string' ? body.message : fallback,
        response.status,
        typeof body.code === 'string' ? body.code : 'request_failed',
        parseIssues(body.issues),
      );
    } catch {
      return new ApiError(fallback, response.status, 'request_failed');
    }
  }
}

function parseIssues(value: unknown): readonly ApiIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (
      typeof issue === 'object' &&
      issue !== null &&
      'path' in issue &&
      typeof issue.path === 'string' &&
      'message' in issue &&
      typeof issue.message === 'string'
    ) {
      return [{ path: issue.path, message: issue.message }];
    }
    return [];
  });
}

function jsonRequest(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
