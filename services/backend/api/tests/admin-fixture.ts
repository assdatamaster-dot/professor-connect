import type {
  AdminServiceContract,
  CreateManagedUserInput,
  DashboardMetrics,
  ListUsersInput,
  ManagedUser,
  ManagedUserStatus,
  PaginatedUsers,
  UserAvatarRecord,
} from '../src/admin/admin.types.js';
import type { AuthenticatedIdentity } from '../src/auth/auth.types.js';

export const MANAGED_USER: ManagedUser = {
  id: '70000000-0000-4000-8000-000000000001',
  profileId: 'teacher-1',
  name: 'Professor Teste',
  email: 'professor@example.edu',
  role: 'TEACHER',
  status: 'ACTIVE',
  online: false,
  hasAvatar: false,
  avatarUpdatedAt: null,
  lastLoginAt: null,
  createdAt: new Date('2026-08-05T10:00:00Z'),
  updatedAt: new Date('2026-08-05T10:00:00Z'),
};

export class TestAdminService implements AdminServiceContract {
  public lastListInput: ListUsersInput | null = null;
  public lastCreatedInput: CreateManagedUserInput | null = null;

  public dashboard(): Promise<DashboardMetrics> {
    return Promise.resolve({
      teachers: 4,
      students: 12,
      onlineTeachers: 2,
      onlineStudents: 5,
      activeAttendances: 1,
      finishedAttendances: 30,
      totalUsers: 17,
      generatedAt: new Date('2026-08-05T12:00:00Z'),
    });
  }
  public listUsers(
    _identity: AuthenticatedIdentity,
    input: ListUsersInput,
  ): Promise<PaginatedUsers> {
    this.lastListInput = input;
    return Promise.resolve({
      items: [MANAGED_USER],
      pagination: { page: input.page, pageSize: input.pageSize, totalItems: 1, totalPages: 1 },
    });
  }
  public createUser(
    _identity: AuthenticatedIdentity,
    input: CreateManagedUserInput,
  ): Promise<ManagedUser> {
    this.lastCreatedInput = input;
    return Promise.resolve(MANAGED_USER);
  }
  public updateUser(): Promise<ManagedUser> {
    return Promise.resolve(MANAGED_USER);
  }
  public updateStatus(
    _identity: AuthenticatedIdentity,
    _userId: string,
    status: ManagedUserStatus,
  ): Promise<ManagedUser> {
    return Promise.resolve({ ...MANAGED_USER, status });
  }
  public resetPassword(): Promise<void> {
    return Promise.resolve();
  }
  public deleteUser(): Promise<void> {
    return Promise.resolve();
  }
  public saveAvatar(): Promise<void> {
    return Promise.resolve();
  }
  public getAvatar(): Promise<UserAvatarRecord> {
    return Promise.resolve({
      mimeType: 'image/png',
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      updatedAt: new Date(),
    });
  }
  public deleteAvatar(): Promise<void> {
    return Promise.resolve();
  }
}
