export type ManagedRole = 'TEACHER' | 'STUDENT';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface Identity {
  readonly userId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

export interface AuthResponse {
  readonly identity: Identity;
  readonly tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
  };
}

export interface DashboardMetrics {
  readonly teachers: number;
  readonly students: number;
  readonly onlineTeachers: number;
  readonly onlineStudents: number;
  readonly activeAttendances: number;
  readonly finishedAttendances: number;
  readonly totalUsers: number;
  readonly generatedAt: string;
}

export interface ManagedUser {
  readonly id: string;
  readonly profileId: string | null;
  readonly name: string;
  readonly email: string;
  readonly role: ManagedRole;
  readonly status: UserStatus;
  readonly online: boolean;
  readonly hasAvatar: boolean;
  readonly avatarUpdatedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export interface UserFilters {
  readonly name: string;
  readonly email: string;
  readonly status: UserStatus | '';
  readonly page: number;
  readonly pageSize: number;
}
