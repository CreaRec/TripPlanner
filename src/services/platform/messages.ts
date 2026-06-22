import type { ConversationMessage } from "@prisma/client";
import { prisma } from "../../db/prisma";

export const PENDING_DESTRUCTIVE_ACTION_ROLE = "pending_destructive_action";

export interface PendingDestructiveAction {
  toolName: string;
  args: Record<string, unknown>;
}

export async function saveMessage(
  telegramId: number,
  tripId: number | null,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await prisma.conversationMessage.create({
    data: { telegramId: BigInt(telegramId), tripId, role, content },
  });
}

export async function recentMessages(
  telegramId: number,
  tripId: number | null,
  limit = 12,
): Promise<ConversationMessage[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      telegramId: BigInt(telegramId),
      role: { in: ["user", "assistant"] },
      ...(tripId !== null ? { OR: [{ tripId }, { tripId: null }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}

export async function savePendingDestructiveAction(
  telegramId: number,
  tripId: number | null,
  action: PendingDestructiveAction,
): Promise<void> {
  await prisma.$transaction([
    prisma.conversationMessage.deleteMany({
      where: {
        telegramId: BigInt(telegramId),
        tripId,
        role: PENDING_DESTRUCTIVE_ACTION_ROLE,
      },
    }),
    prisma.conversationMessage.create({
      data: {
        telegramId: BigInt(telegramId),
        tripId,
        role: PENDING_DESTRUCTIVE_ACTION_ROLE,
        content: JSON.stringify(action),
      },
    }),
  ]);
}

export async function getPendingDestructiveAction(
  telegramId: number,
  tripId: number | null,
): Promise<PendingDestructiveAction | null> {
  const row = await prisma.conversationMessage.findFirst({
    where: {
      telegramId: BigInt(telegramId),
      tripId,
      role: PENDING_DESTRUCTIVE_ACTION_ROLE,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.content) as PendingDestructiveAction;
    if (
      typeof parsed.toolName === "string" &&
      parsed.args &&
      typeof parsed.args === "object" &&
      !Array.isArray(parsed.args)
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed internal state and behave as if no deletion is pending.
  }
  return null;
}

export async function clearPendingDestructiveAction(
  telegramId: number,
  tripId: number | null,
): Promise<void> {
  await prisma.conversationMessage.deleteMany({
    where: {
      telegramId: BigInt(telegramId),
      tripId,
      role: PENDING_DESTRUCTIVE_ACTION_ROLE,
    },
  });
}
