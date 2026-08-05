import type { AuthenticatedIdentity, RequestMetadata } from '../auth/auth.types.js';

export type ManagedUserRole = 'TEACHER' | 'STUDENT';
export type ManagedUserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface DashboardMetrics {
  readonly teachers: number;
  readonly students: number;
  readonly onlineTeachers: number;
  readonly onlineStudents: number;
  readonly activeAttendances: number;
  readonly finishedAttendances: number;
  readonly totalUsers: number;
  readonly generatedAt: Date;
}

export interface ManagedUser {
  readonly id: string;
  readonly profileId: string | null;
  readonly name: string;
  readonly email: string;
  readonly role: ManagedUserRole;
  readonly status: ManagedUserStatus;
  readonly online: boolean;
  readonly hasAvatar: boolean;
  readonly avatarUpdatedAt: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListUsersInput {
  readonly role: ManagedUserRole;
  readonly name?: string;
  readonly email?: string;
  readonly status?: ManagedUserStatus;
  readonly page: number;
  readonly pageSize: number;
}

export interface CreateManagedUserInput {
  readonly role: ManagedUserRole;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly status: ManagedUserStatus;
}

export interface UpdateManagedUserInput {
  readonly name?: string;
  readonly email?: string;
}

export interface PaginatedUsers {
  readonly items: readonly ManagedUser[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
}

export interface UserAvatarRecord {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly updatedAt: Date;
}

export interface AdminServiceContract {
  dashboard(identity: AuthenticatedIdentity): Promise<DashboardMetrics>;
  listUsers(identity: AuthenticatedIdentity, input: ListUsersInput): Promise<PaginatedUsers>;
  createUser(
    identity: AuthenticatedIdentity,
    input: CreateManagedUserInput,
    metadata: RequestMetadata,
  ): Promise<ManagedUser>;
  updateUser(
    identity: AuthenticatedIdentity,
    userId: string,
    input: UpdateManagedUserInput,
    metadata: RequestMetadata,
  ): Promise<ManagedUser>;
  updateStatus(
    identity: AuthenticatedIdentity,
    userId: string,
    status: ManagedUserStatus,
    metadata: RequestMetadata,
  ): Promise<ManagedUser>;
  resetPassword(
    identity: AuthenticatedIdentity,
    userId: string,
    newPassword: string,
    metadata: RequestMetadata,
  ): Promise<void>;
  deleteUser(
    identity: AuthenticatedIdentity,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void>;
  saveAvatar(
    identity: AuthenticatedIdentity,
    userId: string,
    mimeType: string,
    bytes: Uint8Array,
    metadata: RequestMetadata,
  ): Promise<void>;
  getAvatar(identity: AuthenticatedIdentity, userId: string): Promise<UserAvatarRecord>;
  deleteAvatar(
    identity: AuthenticatedIdentity,
    userId: string,
    metadata: RequestMetadata,
  ): Promise<void>;
}

export class AdminError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}
