import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn((ops) => Promise.all(ops)),
    conversationMessage: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../db/prisma", () => ({ prisma: prismaMock }));

import {
  clearPendingDestructiveAction,
  getPendingDestructiveAction,
  PENDING_DESTRUCTIVE_ACTION_ROLE,
  recentMessages,
  saveMessage,
  savePendingDestructiveAction,
} from "./messages";

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("only returns user-visible chat roles", async () => {
    prismaMock.conversationMessage.findMany.mockResolvedValueOnce([]);
    await recentMessages(111, 5);
    const where = prismaMock.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ["user", "assistant"] });
  });

  it("does not add the OR filter when there is no active trip", async () => {
    prismaMock.conversationMessage.findMany.mockResolvedValueOnce([]);
    await recentMessages(111, null);
    const where = prismaMock.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe("pending destructive actions", () => {
  it("replaces any existing pending action for the same trip", async () => {
    await savePendingDestructiveAction(111, 5, {
      toolName: "delete_place",
      args: { place_id: 9 },
    });

    expect(prismaMock.conversationMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        telegramId: 111n,
        tripId: 5,
        role: PENDING_DESTRUCTIVE_ACTION_ROLE,
      },
    });
    expect(prismaMock.conversationMessage.create).toHaveBeenCalledWith({
      data: {
        telegramId: 111n,
        tripId: 5,
        role: PENDING_DESTRUCTIVE_ACTION_ROLE,
        content: JSON.stringify({ toolName: "delete_place", args: { place_id: 9 } }),
      },
    });
  });

  it("loads the latest valid pending action", async () => {
    prismaMock.conversationMessage.findFirst.mockResolvedValueOnce({
      content: JSON.stringify({ toolName: "delete_place", args: { place_id: 9 } }),
    });

    await expect(getPendingDestructiveAction(111, 5)).resolves.toEqual({
      toolName: "delete_place",
      args: { place_id: 9 },
    });
  });

  it("clears pending actions for the same trip", async () => {
    await clearPendingDestructiveAction(111, 5);

    expect(prismaMock.conversationMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        telegramId: 111n,
        tripId: 5,
        role: PENDING_DESTRUCTIVE_ACTION_ROLE,
      },
    });
  });
});
