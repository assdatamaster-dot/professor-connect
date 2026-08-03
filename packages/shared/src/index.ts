export interface StoredAuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: number;
  readonly refreshTokenExpiresAt: number;
  readonly identity: {
    readonly userId: string;
    readonly organizationId: string;
    readonly displayName: string;
    readonly email: string;
    readonly roles: readonly string[];
    readonly profileId?: string;
  };
}

export interface DesktopCredentials {
  readonly email: string;
  readonly password: string;
  readonly organizationSlug?: string;
}

export interface DesktopAuthApi {
  login(credentials: DesktopCredentials): Promise<StoredAuthSession['identity']>;
  logout(): Promise<void>;
  getIdentity(): Promise<StoredAuthSession['identity'] | undefined>;
}

export interface AuthTokenStore {
  load(): Promise<StoredAuthSession | undefined>;
  save(session: StoredAuthSession): Promise<void>;
  clear(): Promise<void>;
}

interface TokenResponse {
  readonly identity: StoredAuthSession['identity'];
  readonly tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly accessTokenExpiresIn: number;
    readonly refreshTokenExpiresIn: number;
  };
}

export class DesktopAuthClient {
  private refreshPromise: Promise<StoredAuthSession> | undefined;

  public constructor(
    private readonly serverUrl: string,
    private readonly store: AuthTokenStore,
    private readonly clock: () => number = Date.now,
  ) {}

  public async login(
    email: string,
    password: string,
    organizationSlug?: string,
  ): Promise<StoredAuthSession['identity']> {
    const result = await this.requestToken('/api/auth/login', {
      email,
      password,
      ...(organizationSlug === undefined || organizationSlug.trim().length === 0
        ? {}
        : { organizationSlug: organizationSlug.trim() }),
    });
    const session = this.toStoredSession(result);
    await this.store.save(session);
    return session.identity;
  }

  public async getAccessToken(): Promise<string> {
    const session = await this.store.load();
    if (session === undefined) throw new Error('Autenticação obrigatória');
    if (session.refreshTokenExpiresAt <= this.clock()) {
      await this.store.clear();
      throw new Error('Sessão expirada');
    }
    if (session.accessTokenExpiresAt - 30_000 > this.clock()) return session.accessToken;
    return (await this.refresh(session)).accessToken;
  }

  public async fetch(input: URL | string, init: RequestInit = {}): Promise<Response> {
    const execute = async (token: string): Promise<Response> =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: `Bearer ${token}`,
        },
      });
    let response = await execute(await this.getAccessToken());
    if (response.status === 401) {
      const current = await this.store.load();
      if (current !== undefined)
        response = await execute((await this.refresh(current)).accessToken);
    }
    return response;
  }

  public async logout(): Promise<void> {
    try {
      const token = await this.getAccessToken();
      await fetch(new URL('/api/auth/logout', this.serverUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      await this.store.clear();
    }
  }

  public async getIdentity(): Promise<StoredAuthSession['identity'] | undefined> {
    return (await this.store.load())?.identity;
  }

  private refresh(session: StoredAuthSession): Promise<StoredAuthSession> {
    this.refreshPromise ??= this.requestToken('/api/auth/refresh', {
      refreshToken: session.refreshToken,
    })
      .then((result) => this.toStoredSession(result))
      .then(async (refreshed) => {
        await this.store.save(refreshed);
        return refreshed;
      })
      .catch(async (error: unknown) => {
        await this.store.clear();
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }

  private async requestToken(path: string, body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(new URL(path, this.serverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Login ou senha inválidos'
          : `Falha de autenticação (${response.status})`,
      );
    return response.json() as Promise<TokenResponse>;
  }

  private toStoredSession(result: TokenResponse): StoredAuthSession {
    const now = this.clock();
    return {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      accessTokenExpiresAt: now + result.tokens.accessTokenExpiresIn * 1000,
      refreshTokenExpiresAt: now + result.tokens.refreshTokenExpiresIn * 1000,
      identity: result.identity,
    };
  }
}
