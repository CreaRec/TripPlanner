import { describe, expect, it } from "vitest";
import { isConnectGmailRequest, parseExportGmailByNumberRequest } from "./gmailIntents";

describe("isConnectGmailRequest", () => {
  it("matches Russian connect-mail phrases", () => {
    expect(isConnectGmailRequest("Подключить почту")).toBe(true);
    expect(isConnectGmailRequest("подключи gmail")).toBe(true);
    expect(isConnectGmailRequest("хочу подключить почту")).toBe(true);
    expect(isConnectGmailRequest("привязать email")).toBe(true);
    expect(isConnectGmailRequest("Добавь аккаунт")).toBe(true);
    expect(isConnectGmailRequest("добавить ещё один ящик")).toBe(true);
  });

  it("matches English connect-mail phrases", () => {
    expect(isConnectGmailRequest("connect gmail")).toBe(true);
    expect(isConnectGmailRequest("link email")).toBe(true);
    expect(isConnectGmailRequest("add mailbox")).toBe(true);
  });

  it("does not match mail search requests", () => {
    expect(isConnectGmailRequest("найди письма в почте")).toBe(false);
    expect(isConnectGmailRequest("find emails about hotel")).toBe(false);
    expect(isConnectGmailRequest("search gmail for booking")).toBe(false);
  });

  it("matches a bare Gmail address as a connect request", () => {
    expect(isConnectGmailRequest("creativerap@gmail.com")).toBe(true);
    expect(isConnectGmailRequest("  User.Name+tag@gmail.com  ")).toBe(true);
  });

  it("ignores slash commands and unrelated text", () => {
    expect(isConnectGmailRequest("/connect_gmail")).toBe(false);
    expect(isConnectGmailRequest("plan my trip")).toBe(false);
    expect(isConnectGmailRequest("")).toBe(false);
    expect(isConnectGmailRequest("email me the itinerary")).toBe(false);
  });
});

describe("parseExportGmailByNumberRequest", () => {
  it("matches export-by-number phrases", () => {
    expect(parseExportGmailByNumberRequest("Дай письмо 2")).toBe(2);
    expect(parseExportGmailByNumberRequest("дай письмо 3")).toBe(3);
    expect(parseExportGmailByNumberRequest("письмо 1")).toBe(1);
    expect(parseExportGmailByNumberRequest("email 4")).toBe(4);
    expect(parseExportGmailByNumberRequest("export message 5")).toBe(5);
  });

  it("does not match search or unrelated text", () => {
    expect(parseExportGmailByNumberRequest("найди письма про отель")).toBeNull();
    expect(parseExportGmailByNumberRequest("find emails about hotel")).toBeNull();
    expect(parseExportGmailByNumberRequest("plan my trip")).toBeNull();
    expect(parseExportGmailByNumberRequest("/export 2")).toBeNull();
  });
});
