import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  oAuthState: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import {
  consumeOAuthState,
  createOAuthState,
  GOOGLE_GMAIL_PROVIDER,
  validateOAuthState,
} from "./oauthState";

describe("oauthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validateOAuthState returns telegram id without deleting", async () => {
    prismaMock.oAuthState.findUnique.mockResolvedValueOnce({
      id: "state-1",
      telegramId: BigInt(111),
      provider: GOOGLE_GMAIL_PROVIDER,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await validateOAuthState("state-1", GOOGLE_GMAIL_PROVIDER);
    expect(result).toEqual({ telegramId: 111 });
    expect(prismaMock.oAuthState.delete).not.toHaveBeenCalled();
  });

  it("consumeOAuthState deletes a valid state", async () => {
    prismaMock.oAuthState.findUnique.mockResolvedValueOnce({
      id: "state-2",
      telegramId: BigInt(222),
      provider: GOOGLE_GMAIL_PROVIDER,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await consumeOAuthState("state-2", GOOGLE_GMAIL_PROVIDER);
    expect(result).toEqual({ telegramId: 222 });
    expect(prismaMock.oAuthState.delete).toHaveBeenCalledWith({ where: { id: "state-2" } });
  });

  it("createOAuthState stores a new row", async () => {
    prismaMock.oAuthState.create.mockResolvedValueOnce({});
    const id = await createOAuthState(333, GOOGLE_GMAIL_PROVIDER);
    expect(id).toMatch(/^[0-9a-f]{48}$/);
    expect(prismaMock.oAuthState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telegramId: BigInt(333),
          provider: GOOGLE_GMAIL_PROVIDER,
        }),
      }),
    );
  });
});
