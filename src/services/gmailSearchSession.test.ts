import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountById: vi.fn(),
  exportGmailMessageToEml: vi.fn(),
}));

vi.mock("./gmailAccounts", () => ({ getAccountById: mocks.getAccountById }));
vi.mock("./gmailExport", () => ({ exportGmailMessageToEml: mocks.exportGmailMessageToEml }));

import {
  clearGmailSearchSessions,
  exportGmailBySearchIndex,
  formatGmailSearchSessionContext,
  getGmailSearchSession,
  saveGmailSearchSession,
} from "./gmailSearchSession";

describe("gmailSearchSession", () => {
  beforeEach(() => {
    clearGmailSearchSessions();
    mocks.getAccountById.mockReset();
    mocks.exportGmailMessageToEml.mockReset();
  });

  it("stores and formats recent search results", () => {
    saveGmailSearchSession(111, {
      accounts_searched: ["work@gmail.com"],
      query_used: "Paris hotel",
      messages: [
        {
          gmail_account_id: 2,
          account_email: "work@gmail.com",
          id: "msg-1",
          thread_id: "t1",
          subject: "Hotel A",
          from: "hotel@example.com",
          date: null,
          snippet: "confirmed",
        },
      ],
    });

    const session = getGmailSearchSession(111);
    expect(session?.messages).toHaveLength(1);
    expect(formatGmailSearchSessionContext(session!)).toContain("message_id=msg-1");
    expect(formatGmailSearchSessionContext(session!)).toContain("1.");
  });

  it("exports a message from the cached search by index", async () => {
    saveGmailSearchSession(111, {
      accounts_searched: ["work@gmail.com"],
      query_used: "Paris hotel",
      messages: [
        {
          gmail_account_id: 2,
          account_email: "work@gmail.com",
          id: "msg-1",
          thread_id: "t1",
          subject: "Hotel A",
          from: "hotel@example.com",
          date: null,
          snippet: "confirmed",
        },
        {
          gmail_account_id: 2,
          account_email: "work@gmail.com",
          id: "msg-2",
          thread_id: "t2",
          subject: "Hotel B",
          from: "hotel@example.com",
          date: null,
          snippet: "confirmed",
        },
      ],
    });

    mocks.getAccountById.mockResolvedValue({ id: 2, status: "active" });
    mocks.exportGmailMessageToEml.mockResolvedValue({
      filePath: "/tmp/hotel-b-msg2.eml",
      subject: "Hotel B",
      from: "hotel@example.com",
      date: null,
    });

    const result = await exportGmailBySearchIndex(111, 2);
    expect(result).toEqual({
      ok: true,
      filePath: "/tmp/hotel-b-msg2.eml",
      subject: "Hotel B",
      index: 2,
    });
    expect(mocks.exportGmailMessageToEml).toHaveBeenCalledWith(
      { id: 2, status: "active" },
      "msg-2",
    );
  });

  it("reports when the export index is out of range", async () => {
    saveGmailSearchSession(111, {
      accounts_searched: ["work@gmail.com"],
      query_used: "Paris hotel",
      messages: [
        {
          gmail_account_id: 2,
          account_email: "work@gmail.com",
          id: "msg-1",
          thread_id: "t1",
          subject: "Hotel A",
          from: "hotel@example.com",
          date: null,
          snippet: "confirmed",
        },
      ],
    });

    const result = await exportGmailBySearchIndex(111, 3);
    expect(result).toEqual({ ok: false, reason: "invalid_index", count: 1 });
  });
});
