import { describe, expect, it, vi } from "vitest";

const { prismaMock, embedMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    memory: { findMany: vi.fn() },
  },
  embedMock: vi.fn(),
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));
vi.mock("../openai/embeddings", () => ({
  embed: embedMock,
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { listMemories, saveMemory, searchMemories } from "./memories";

describe("saveMemory", () => {
  it("embeds the content and returns the inserted row", async () => {
    embedMock.mockResolvedValueOnce([1, 2, 3]);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 1, trip_id: 5, kind: "preference", content: "likes hikes" },
    ]);
    const row = await saveMemory({
      telegramId: 111,
      tripId: 5,
      kind: "preference",
      content: "likes hikes",
    });
    expect(embedMock).toHaveBeenCalledWith("likes hikes");
    expect(row).toEqual({ id: 1, trip_id: 5, kind: "preference", content: "likes hikes" });
  });
});

describe("searchMemories", () => {
  it("embeds the query and returns matched rows", async () => {
    embedMock.mockResolvedValueOnce([0.1, 0.2]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 2, trip_id: null, kind: "fact", content: "x" }]);
    const rows = await searchMemories({ telegramId: 111, tripId: 5, queryText: "hiking" });
    expect(embedMock).toHaveBeenCalledWith("hiking");
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("x");
  });
});

describe("listMemories", () => {
  it("maps the typed rows to snake_case records", async () => {
    prismaMock.memory.findMany.mockResolvedValueOnce([
      { id: 7, tripId: 5, kind: "fact", content: "hello" },
    ]);
    const rows = await listMemories(111, 5);
    expect(rows).toEqual([{ id: 7, trip_id: 5, kind: "fact", content: "hello" }]);
  });
});
