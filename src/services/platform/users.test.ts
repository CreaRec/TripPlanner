import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tgUser: { upsert: vi.fn() },
    appState: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("../../db/prisma", () => ({ prisma: prismaMock }));

import { ensureUser, getActiveTripId, setActiveTripId } from "./users";

describe("ensureUser", () => {
  it("upserts the user with BigInt id and updates the name", async () => {
    await ensureUser(111, "Alice");
    expect(prismaMock.tgUser.upsert).toHaveBeenCalledWith({
      where: { telegramId: 111n },
      create: { telegramId: 111n, name: "Alice" },
      update: { name: "Alice" },
    });
  });

  it("does not overwrite the name when none is provided", async () => {
    await ensureUser(222);
    expect(prismaMock.tgUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
});

describe("getActiveTripId", () => {
  it("returns the active trip id when present", async () => {
    prismaMock.appState.findUnique.mockResolvedValueOnce({ activeTripId: 7 });
    expect(await getActiveTripId(111)).toBe(7);
  });

  it("returns null when there is no state row", async () => {
    prismaMock.appState.findUnique.mockResolvedValueOnce(null);
    expect(await getActiveTripId(111)).toBeNull();
  });
});

describe("setActiveTripId", () => {
  it("upserts the app state", async () => {
    await setActiveTripId(111, 9);
    expect(prismaMock.appState.upsert).toHaveBeenCalledWith({
      where: { telegramId: 111n },
      create: { telegramId: 111n, activeTripId: 9 },
      update: { activeTripId: 9 },
    });
  });
});
