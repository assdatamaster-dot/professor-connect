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

export interface BootstrapStatus {
  readonly initialized: boolean;
}

export interface BootstrapSetupInput {
  readonly organization: {
    readonly name: string;
    readonly tradeName: string;
    readonly taxId: string;
    readonly slug: string;
    readonly city: string;
    readonly state: string;
    readonly country: string;
    readonly timezone: string;
    readonly language: string;
  };
  readonly administrator: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly password: string;
    readonly confirmPassword: string;
    readonly phone: string;
  };
  readonly settings: {
    readonly systemName: string;
    readonly theme: 'light' | 'dark' | 'system';
    readonly language: string;
    readonly defaults: {
      readonly sessionDurationMinutes: number;
      readonly allowSelfRegistration: boolean;
    };
  };
}

export interface BootstrapSetupResult extends AuthResponse {
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
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

export interface UpdateMetricsItem {
  readonly application: 'teacher' | 'student';
  readonly channel: 'stable' | 'beta' | 'development';
  readonly latestVersion: string | null;
  readonly publishedAt: string | null;
  readonly totalClients: number;
  readonly updatedClients: number;
  readonly outdatedClients: number;
  readonly currentVersions: readonly { readonly version: string; readonly count: number }[];
}

export interface UpdateMetrics {
  readonly items: readonly UpdateMetricsItem[];
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
