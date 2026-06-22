import { prisma } from "../../db/prisma";

export async function ensureUser(telegramId: number, name?: string): Promise<void> {
  const id = BigInt(telegramId);
  await prisma.tgUser.upsert({
    where: { telegramId: id },
    create: { telegramId: id, name: name ?? null },
    update: name ? { name } : {},
  });
}

export async function getActiveTripId(telegramId: number): Promise<number | null> {
  const state = await prisma.appState.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  return state?.activeTripId ?? null;
}

export async function setActiveTripId(
  telegramId: number,
  tripId: number | null,
): Promise<void> {
  const id = BigInt(telegramId);
  await prisma.appState.upsert({
    where: { telegramId: id },
    create: { telegramId: id, activeTripId: tripId },
    update: { activeTripId: tripId },
  });
}
