import { PrismaClient, UserRoleName } from '@prisma/client';

const prisma = new PrismaClient();

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

async function seedReferenceData(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    for (const role of Object.values(UserRoleName)) {
      await transaction.role.upsert({
        where: { name: role },
        create: { name: role, description: `Perfil ${role.toLowerCase()}` },
        update: {},
      });
    }
    for (const code of [...new Set(Object.values(permissionsByRole).flat())]) {
      await transaction.permission.upsert({
        where: { code },
        create: { code, description: `Permissão ${code}` },
        update: {},
      });
    }
    for (const [roleName, codes] of Object.entries(permissionsByRole) as [
      UserRoleName,
      readonly string[],
    ][]) {
      const role = await transaction.role.findUniqueOrThrow({ where: { name: roleName } });
      const permissions = await transaction.permission.findMany({
        where: { code: { in: [...codes] } },
      });
      for (const permission of permissions) {
        await transaction.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
    }
  });
}

seedReferenceData()
  .then(() => console.info('Dados de referência sincronizados; nenhum usuário foi criado.'))
  .finally(() => prisma.$disconnect());
