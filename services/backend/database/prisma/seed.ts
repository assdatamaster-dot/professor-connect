import { AttendanceSessionStatus, PrismaClient, RequestStatus, UserRoleName } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const organizationId = '10000000-0000-4000-8000-000000000001';
const professorId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const sessionId = '40000000-0000-4000-8000-000000000001';
const studentId = 'student-development-01';
const adminUserId = '50000000-0000-4000-8000-000000000001';
const professorUserId = '50000000-0000-4000-8000-000000000002';
const studentUserId = '50000000-0000-4000-8000-000000000003';

const permissionsByRole: Readonly<Record<UserRoleName, readonly string[]>> = {
  ADMIN: [
    'socket.connect',
    'professors.online.read',
    'students.online.read',
    'sessions.read',
    'session.request',
    'session.respond',
    'webrtc.use',
    'remote-control.request',
    'remote-control.approve',
    'files.transfer',
    'users.manage',
    'audit.read',
  ],
  TEACHER: [
    'socket.connect',
    'students.online.read',
    'sessions.read',
    'session.respond',
    'webrtc.use',
    'remote-control.request',
    'files.transfer',
  ],
  STUDENT: [
    'socket.connect',
    'professors.online.read',
    'sessions.read',
    'session.request',
    'webrtc.use',
    'remote-control.approve',
    'files.transfer',
  ],
};

async function seed(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.organization.upsert({
      where: { slug: 'escola-desenvolvimento' },
      create: {
        id: organizationId,
        name: 'Escola de Desenvolvimento',
        slug: 'escola-desenvolvimento',
      },
      update: { name: 'Escola de Desenvolvimento' },
    });

    for (const role of Object.values(UserRoleName)) {
      await transaction.role.upsert({
        where: { name: role },
        create: { name: role, description: `Perfil ${role.toLowerCase()}` },
        update: {},
      });
    }

    const permissionCodes = [...new Set(Object.values(permissionsByRole).flat())];
    for (const code of permissionCodes) {
      await transaction.permission.upsert({
        where: { code },
        create: { code, description: `Permissão ${code}` },
        update: {},
      });
    }
    for (const [roleName, permissionCodesForRole] of Object.entries(permissionsByRole) as [
      UserRoleName,
      readonly string[],
    ][]) {
      const role = await transaction.role.findUniqueOrThrow({ where: { name: roleName } });
      const permissions = await transaction.permission.findMany({
        where: { code: { in: [...permissionCodesForRole] } },
      });
      for (const permission of permissions) {
        await transaction.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
    }

    const developmentPassword = 'Professor#Connect2026!';
    const seedPassword =
      process.env.SEED_PASSWORD ??
      (process.env.NODE_ENV === 'production' ? undefined : developmentPassword);
    if (seedPassword === undefined)
      throw new Error('SEED_PASSWORD é obrigatória para executar seed em produção');
    const passwordHash = await bcrypt.hash(seedPassword, 12);
    const users = [
      {
        id: adminUserId,
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@professor-connect.local',
        displayName: 'Administrador',
        role: UserRoleName.ADMIN,
      },
      {
        id: professorUserId,
        email: process.env.SEED_TEACHER_EMAIL ?? 'professor@professor-connect.local',
        displayName: 'Professor Desenvolvimento',
        role: UserRoleName.TEACHER,
      },
      {
        id: studentUserId,
        email: process.env.SEED_STUDENT_EMAIL ?? 'aluno@professor-connect.local',
        displayName: 'Aluno Desenvolvimento',
        role: UserRoleName.STUDENT,
      },
    ] as const;
    for (const seedUser of users) {
      const user = await transaction.user.upsert({
        where: { id: seedUser.id },
        create: {
          id: seedUser.id,
          organizationId,
          email: seedUser.email.toLowerCase(),
          displayName: seedUser.displayName,
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'ACTIVE',
        },
        update: {
          organizationId,
          email: seedUser.email.toLowerCase(),
          displayName: seedUser.displayName,
          status: 'ACTIVE',
        },
      });
      const role = await transaction.role.findUniqueOrThrow({ where: { name: seedUser.role } });
      await transaction.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      });
    }

    await transaction.professor.upsert({
      where: { id: professorId },
      create: {
        id: professorId,
        organizationId,
        userId: professorUserId,
        name: 'Professor Desenvolvimento',
      },
      update: { organizationId, userId: professorUserId, name: 'Professor Desenvolvimento' },
    });
    await transaction.student.upsert({
      where: { id: studentId },
      create: {
        id: studentId,
        organizationId,
        userId: studentUserId,
        name: 'Aluno Desenvolvimento',
      },
      update: { organizationId, userId: studentUserId, name: 'Aluno Desenvolvimento' },
    });
    await transaction.sessionRequest.upsert({
      where: { id: requestId },
      create: {
        id: requestId,
        professorId,
        studentId,
        status: RequestStatus.ACCEPTED,
        createdAt: new Date('2026-07-31T12:00:00.000Z'),
        respondedAt: new Date('2026-07-31T12:00:05.000Z'),
      },
      update: {},
    });
    await transaction.attendanceSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        requestId,
        professorId,
        studentId,
        status: AttendanceSessionStatus.FINISHED,
        startedAt: new Date('2026-07-31T12:00:05.000Z'),
        endedAt: new Date('2026-07-31T12:15:05.000Z'),
        durationSeconds: 900,
        endReason: 'seed-development',
      },
      update: {},
    });
  });
}

seed()
  .then(() => console.info('Seed de desenvolvimento concluído'))
  .finally(() => prisma.$disconnect());
