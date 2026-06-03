import { describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("./client", () => ({
  openai: { embeddings: { create: createMock } },
}));

import { embed, toVectorLiteral } from "./embeddings";

describe("toVectorLiteral", () => {
  it("formats a numeric vector as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("handles an empty vector", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("embed", () => {
  it("returns the embedding from the OpenAI response", async () => {
    createMock.mockResolvedValueOnce({ data: [{ embedding: [1, 2, 3] }] });
    const result = await embed("hello world");
    expect(result).toEqual([1, 2, 3]);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("collapses newlines and truncates very long input", async () => {
    createMock.mockResolvedValueOnce({ data: [{ embedding: [0] }] });
    const long = "a\nb".padEnd(10000, "x");
    await embed(long);
    const arg = createMock.mock.calls[0][0];
    expect(arg.input).not.toContain("\n");
    expect(arg.input.length).toBeLessThanOrEqual(8000);
  });
});
