import type { GmailAccount } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { encrypt } from "./tokenCrypto";

export interface GmailTokenBundle {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scopes: string;
}

export async function listAccounts(
  telegramId: number,
  options: { activeOnly?: boolean } = {},
): Promise<GmailAccount[]> {
  return prisma.gmailAccount.findMany({
    where: {
      telegramId: BigInt(telegramId),
      ...(options.activeOnly ? { status: "active" } : {}),
    },
    orderBy: { connectedAt: "asc" },
  });
}

export async function getAccountById(
  telegramId: number,
  accountId: number,
): Promise<GmailAccount | null> {
  return prisma.gmailAccount.findFirst({
    where: { id: accountId, telegramId: BigInt(telegramId) },
  });
}

export async function getAccountByEmail(
  telegramId: number,
  googleEmail: string,
): Promise<GmailAccount | null> {
  return prisma.gmailAccount.findUnique({
    where: {
      telegramId_googleEmail: {
        telegramId: BigInt(telegramId),
        googleEmail: googleEmail.toLowerCase(),
      },
    },
  });
}

export async function upsertAccount(
  telegramId: number,
  googleEmail: string,
  tokens: GmailTokenBundle,
): Promise<GmailAccount> {
  const email = googleEmail.toLowerCase();
  const existing = await getAccountByEmail(telegramId, email);
  const data = {
    accessTokenEnc: encrypt(tokens.accessToken),
    refreshTokenEnc: encrypt(tokens.refreshToken),
    tokenExpiresAt: tokens.tokenExpiresAt,
    scopes: tokens.scopes,
    status: "active",
  };

  if (existing) {
    return prisma.gmailAccount.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.gmailAccount.create({
    data: {
      telegramId: BigInt(telegramId),
      googleEmail: email,
      ...data,
    },
  });
}

export async function disconnectAccount(
  telegramId: number,
  identifier: { id?: number; googleEmail?: string },
): Promise<boolean> {
  const account =
    identifier.id !== undefined
      ? await getAccountById(telegramId, identifier.id)
      : identifier.googleEmail
        ? await getAccountByEmail(telegramId, identifier.googleEmail)
        : null;
  if (!account) return false;

  await prisma.gmailAccount.delete({ where: { id: account.id } });
  return true;
}

export async function markAccountInvalid(accountId: number): Promise<void> {
  await prisma.gmailAccount.update({
    where: { id: accountId },
    data: { status: "invalid" },
  });
}

export async function updateAccountTokens(
  accountId: number,
  tokens: Pick<GmailTokenBundle, "accessToken" | "tokenExpiresAt">,
): Promise<void> {
  await prisma.gmailAccount.update({
    where: { id: accountId },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      tokenExpiresAt: tokens.tokenExpiresAt,
      status: "active",
    },
  });
}

export function formatGmailContextLine(accounts: GmailAccount[]): string {
  if (accounts.length === 0) return "Gmail: not connected.";
  const parts = accounts.map((a) => {
    const status = a.status === "active" ? "" : ` [${a.status}]`;
    return `${a.googleEmail}${status}`;
  });
  return `Gmail: ${accounts.length} account(s) connected — ${parts.join(", ")}.`;
}
