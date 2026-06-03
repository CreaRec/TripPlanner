import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
