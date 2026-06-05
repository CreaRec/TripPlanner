import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountById: vi.fn(),
  exportGmailMessageToPdf: vi.fn(),
}));

vi.mock("./gmailAccounts", () => ({ getAccountById: mocks.getAccountById }));
vi.mock("./gmailExport", () => ({ exportGmailMessageToPdf: mocks.exportGmailMessageToPdf }));

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
    mocks.exportGmailMessageToPdf.mockReset();
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
    mocks.exportGmailMessageToPdf.mockResolvedValue({
      filePath: "/tmp/hotel-b-msg2.pdf",
      subject: "Hotel B",
      from: "hotel@example.com",
      date: null,
    });

    const result = await exportGmailBySearchIndex(111, 2);
    expect(result).toEqual({
      ok: true,
      filePath: "/tmp/hotel-b-msg2.pdf",
      subject: "Hotel B",
      index: 2,
    });
    expect(mocks.exportGmailMessageToPdf).toHaveBeenCalledWith(
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

  it("does not overwrite a non-empty session with an empty search", () => {
    saveGmailSearchSession(111, {
      accounts_searched: ["personal@gmail.com", "work@gmail.com"],
      query_used: "booking",
      messages: [
        {
          gmail_account_id: 1,
          account_email: "personal@gmail.com",
          id: "msg-1",
          thread_id: "t1",
          subject: "Booking 1",
          from: "booking@example.com",
          date: null,
          snippet: "confirmed",
        },
      ],
    });

    saveGmailSearchSession(111, {
      accounts_searched: ["work@gmail.com"],
      query_used: "booking",
      messages: [],
    });

    const session = getGmailSearchSession(111);
    expect(session?.messages).toHaveLength(1);
    expect(session?.messages[0]?.id).toBe("msg-1");
  });

  it("replaces a session when a new search returns messages", () => {
    saveGmailSearchSession(111, {
      accounts_searched: ["personal@gmail.com"],
      query_used: "booking",
      messages: [
        {
          gmail_account_id: 1,
          account_email: "personal@gmail.com",
          id: "msg-old",
          thread_id: "t1",
          subject: "Old",
          from: "a@example.com",
          date: null,
          snippet: "",
        },
      ],
    });

    saveGmailSearchSession(111, {
      accounts_searched: ["personal@gmail.com"],
      query_used: "hotel",
      messages: [
        {
          gmail_account_id: 1,
          account_email: "personal@gmail.com",
          id: "msg-new",
          thread_id: "t2",
          subject: "New",
          from: "b@example.com",
          date: null,
          snippet: "",
        },
      ],
    });

    expect(getGmailSearchSession(111)?.messages[0]?.id).toBe("msg-new");
  });
});
