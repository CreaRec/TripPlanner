import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_GMAIL_PROVIDER = "google_gmail";

export async function createOAuthState(telegramId: number, provider: string): Promise<string> {
  const id = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
  await prisma.oAuthState.create({
    data: {
      id,
      telegramId: BigInt(telegramId),
      provider,
      expiresAt,
    },
  });
  return id;
}

export async function validateOAuthState(
  stateId: string,
  provider: string,
): Promise<{ telegramId: number } | null> {
  const state = await prisma.oAuthState.findUnique({ where: { id: stateId } });
  if (!state || state.provider !== provider) return null;
  if (state.expiresAt.getTime() < Date.now()) {
    await prisma.oAuthState.delete({ where: { id: stateId } }).catch(() => undefined);
    return null;
  }
  return { telegramId: Number(state.telegramId) };
}

export async function consumeOAuthState(
  stateId: string,
  provider: string,
): Promise<{ telegramId: number } | null> {
  const state = await prisma.oAuthState.findUnique({ where: { id: stateId } });
  if (!state || state.provider !== provider) return null;
  if (state.expiresAt.getTime() < Date.now()) {
    await prisma.oAuthState.delete({ where: { id: stateId } }).catch(() => undefined);
    return null;
  }
  await prisma.oAuthState.delete({ where: { id: stateId } });
  return { telegramId: Number(state.telegramId) };
}

export async function purgeExpiredOAuthStates(): Promise<void> {
  await prisma.oAuthState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
