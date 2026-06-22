import { describe, expect, it, vi } from "vitest";

const { createMock, saveMemoryMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  saveMemoryMock: vi.fn(),
}));

vi.mock("../openai/client", () => ({
  openai: { chat: { completions: { create: createMock } } },
}));
vi.mock("../services/trip/memories", () => ({ saveMemory: saveMemoryMock }));

import { extractMemories } from "./memory";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("extractMemories", () => {
  it("saves each extracted memory", async () => {
    createMock.mockResolvedValueOnce(
      reply(JSON.stringify({ memories: [
        { kind: "preference", content: "likes national parks" },
        { kind: "constraint", content: "child is 7" },
      ] })),
    );
    await extractMemories(111, 5, "u", "a");
    expect(saveMemoryMock).toHaveBeenCalledTimes(2);
    expect(saveMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: 111, tripId: 5, kind: "preference", content: "likes national parks" }),
    );
  });

  it("saves nothing when there are no memories", async () => {
    createMock.mockResolvedValueOnce(reply(JSON.stringify({ memories: [] })));
    await extractMemories(111, null, "u", "a");
    expect(saveMemoryMock).not.toHaveBeenCalled();
  });

  it("ignores invalid JSON", async () => {
    createMock.mockResolvedValueOnce(reply("not json"));
    await extractMemories(111, null, "u", "a");
    expect(saveMemoryMock).not.toHaveBeenCalled();
  });

  it("skips entries with empty content", async () => {
    createMock.mockResolvedValueOnce(
      reply(JSON.stringify({ memories: [{ kind: "fact", content: "  " }] })),
    );
    await extractMemories(111, null, "u", "a");
    expect(saveMemoryMock).not.toHaveBeenCalled();
  });
});
