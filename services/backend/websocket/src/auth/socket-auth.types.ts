export type SocketUserRole = 'ADMIN' | 'TEACHER' | 'STUDENT';

export interface SocketIdentity {
  readonly userId: string;
  readonly organizationId: string;
  readonly displayName: string;
  readonly roles: readonly SocketUserRole[];
  readonly permissions: readonly string[];
  readonly profileId: string | undefined;
  readonly sessionFamilyId: string;
}

export interface SocketAuthenticationOptions {
  authenticate(accessToken: string): Promise<SocketIdentity>;
}

export interface AuthenticatedSocketData {
  identity: SocketIdentity;
}
