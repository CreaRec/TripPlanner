import type { ConversationMessage } from "@prisma/client";
import { prisma } from "../db/prisma";

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
      ...(tripId !== null ? { OR: [{ tripId }, { tripId: null }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}
