import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    conversationMessage: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { recentMessages, saveMessage } from "./messages";

describe("saveMessage", () => {
  it("stores a message with BigInt user id", async () => {
    await saveMessage(111, 5, "user", "hello");
    expect(prismaMock.conversationMessage.create).toHaveBeenCalledWith({
      data: { telegramId: 111n, tripId: 5, role: "user", content: "hello" },
    });
  });
});

describe("recentMessages", () => {
  it("returns rows in chronological order (reversed from desc query)", async () => {
    prismaMock.conversationMessage.findMany.mockResolvedValueOnce([
      { id: 3, content: "c" },
      { id: 2, content: "b" },
      { id: 1, content: "a" },
    ]);
    const rows = await recentMessages(111, 5, 12);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("includes trip and global messages when a trip is active", async () => {
    prismaMock.conversationMessage.findMany.mockResolvedValueOnce([]);
    await recentMessages(111, 5);
    const where = prismaMock.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ tripId: 5 }, { tripId: null }]);
  });

  it("does not add the OR filter when there is no active trip", async () => {
    prismaMock.conversationMessage.findMany.mockResolvedValueOnce([]);
    await recentMessages(111, null);
    const where = prismaMock.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});
