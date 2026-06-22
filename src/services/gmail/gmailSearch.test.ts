import { describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "@prisma/client";

vi.mock("./gmailClient", () => ({
  listMessagesForAccount: vi.fn(),
}));

import { listMessagesForAccount } from "./gmailClient";
import { searchGmailAccounts } from "./gmailSearch";

function account(id: number, email: string): GmailAccount {
  return {
    id,
    telegramId: BigInt(111),
    googleEmail: email,
    accessTokenEnc: "enc",
    refreshTokenEnc: "enc",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    scopes: "gmail.readonly",
    status: "active",
    connectedAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("searchGmailAccounts", () => {
  it("merges results from multiple accounts without urls", async () => {
    vi.mocked(listMessagesForAccount)
      .mockResolvedValueOnce([
        {
          id: "m1",
          threadId: "t1",
          subject: "Hotel A",
          from: "hotel@example.com",
          date: "Mon, 2 Jun 2026 10:00:00 +0000",
          snippet: "booking confirmed",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m2",
          threadId: "t2",
          subject: "Flight B",
          from: "airline@example.com",
          date: "Tue, 3 Jun 2026 12:00:00 +0000",
          snippet: "itinerary",
        },
      ]);

    const result = await searchGmailAccounts(
      [account(1, "personal@gmail.com"), account(2, "work@gmail.com")],
      { q: "Paris", maxResults: 10 },
    );

    expect(result.accounts_searched).toEqual(["personal@gmail.com", "work@gmail.com"]);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.account_email).toBe("work@gmail.com");
    expect(result.messages[0]).not.toHaveProperty("gmail_url");
    expect(result).not.toHaveProperty("gmail_search_urls");
  });

  it("collects per-account errors without failing the whole search", async () => {
    vi.mocked(listMessagesForAccount)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("invalid_grant"));

    const result = await searchGmailAccounts(
      [account(1, "personal@gmail.com"), account(2, "work@gmail.com")],
      { q: "Paris", maxResults: 5 },
    );

    expect(result.account_errors).toEqual([
      { account_email: "work@gmail.com", error: "invalid_grant" },
    ]);
  });
});
