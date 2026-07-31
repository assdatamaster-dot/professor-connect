import { AttendanceSessionStatus, PrismaClient, RequestStatus, UserRoleName } from '@prisma/client';

const prisma = new PrismaClient();

const organizationId = '10000000-0000-4000-8000-000000000001';
const professorId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const sessionId = '40000000-0000-4000-8000-000000000001';
const studentId = 'student-development-01';

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

    await transaction.professor.upsert({
      where: { id: professorId },
      create: { id: professorId, organizationId, name: 'Professor Desenvolvimento' },
      update: { organizationId, name: 'Professor Desenvolvimento' },
    });
    await transaction.student.upsert({
      where: { id: studentId },
      create: { id: studentId, organizationId, name: 'Aluno Desenvolvimento' },
      update: { organizationId, name: 'Aluno Desenvolvimento' },
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
