import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  gmailAccount: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));
vi.mock("./tokenCrypto", () => ({
  encrypt: (value: string) => `enc:${value}`,
}));

import { disconnectAccount, formatGmailContextLine, upsertAccount } from "./gmailAccounts";

describe("gmailAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new account without default flags", async () => {
    prismaMock.gmailAccount.findUnique.mockResolvedValue(null);
    prismaMock.gmailAccount.create.mockResolvedValue({
      id: 1,
      googleEmail: "user@gmail.com",
      status: "active",
    });

    await upsertAccount(111, "user@gmail.com", {
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiresAt: new Date("2026-06-01T00:00:00Z"),
      scopes: "gmail.readonly",
    });

    expect(prismaMock.gmailAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telegramId: BigInt(111),
          googleEmail: "user@gmail.com",
        }),
      }),
    );
    expect(prismaMock.gmailAccount.create.mock.calls[0][0].data).not.toHaveProperty("isDefault");
  });

  it("updates tokens for an existing email", async () => {
    prismaMock.gmailAccount.findUnique.mockResolvedValue({ id: 2, googleEmail: "user@gmail.com" });
    prismaMock.gmailAccount.update.mockResolvedValue({ id: 2 });

    await upsertAccount(111, "User@gmail.com", {
      accessToken: "new-access",
      refreshToken: "refresh",
      tokenExpiresAt: new Date("2026-06-02T00:00:00Z"),
      scopes: "gmail.readonly",
    });

    expect(prismaMock.gmailAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
    expect(prismaMock.gmailAccount.create).not.toHaveBeenCalled();
  });

  it("deletes an account on disconnect without promoting another default", async () => {
    prismaMock.gmailAccount.findUnique.mockResolvedValue({
      id: 1,
      googleEmail: "old@gmail.com",
      status: "active",
    });
    prismaMock.gmailAccount.delete.mockResolvedValue({});

    const ok = await disconnectAccount(111, { googleEmail: "old@gmail.com" });
    expect(ok).toBe(true);
    expect(prismaMock.gmailAccount.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prismaMock.gmailAccount.update).not.toHaveBeenCalled();
  });

  it("formats gmail context for the agent", () => {
    expect(formatGmailContextLine([])).toBe("Gmail: not connected.");
    expect(
      formatGmailContextLine([
        {
          id: 1,
          telegramId: BigInt(1),
          googleEmail: "a@gmail.com",
          accessTokenEnc: "",
          refreshTokenEnc: "",
          tokenExpiresAt: new Date(),
          scopes: "",
          status: "active",
          connectedAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    ).toContain("a@gmail.com");
    expect(
      formatGmailContextLine([
        {
          id: 1,
          telegramId: BigInt(1),
          googleEmail: "a@gmail.com",
          accessTokenEnc: "",
          refreshTokenEnc: "",
          tokenExpiresAt: new Date(),
          scopes: "",
          status: "active",
          connectedAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    ).not.toContain("default");
  });
});
