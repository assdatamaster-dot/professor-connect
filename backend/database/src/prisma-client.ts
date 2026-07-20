import { PrismaClient } from '@prisma/client';

interface GlobalWithPrismaClient {
  prismaClient?: PrismaClient;
}

const globalWithPrismaClient = globalThis as GlobalWithPrismaClient;

export const prismaClient = globalWithPrismaClient.prismaClient ?? new PrismaClient();

globalWithPrismaClient.prismaClient = prismaClient;
