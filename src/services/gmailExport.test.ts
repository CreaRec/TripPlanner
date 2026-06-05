import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchGmailMessageContent: vi.fn(),
  buildMessageHtml: vi.fn(),
  renderHtmlToPdf: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("./gmailClient", () => ({ fetchGmailMessageContent: mocks.fetchGmailMessageContent }));
vi.mock("./gmailMessageHtml", () => ({ buildMessageHtml: mocks.buildMessageHtml }));
vi.mock("./gmailPdf", () => ({ renderHtmlToPdf: mocks.renderHtmlToPdf }));
vi.mock("../config", () => ({ config: { dataDir: "/tmp/gmail-exports" } }));

import { exportGmailMessageToPdf, slugifyEmailFilename } from "./gmailExport";

describe("slugifyEmailFilename", () => {
  it("slugifies subjects for safe filenames", () => {
    expect(slugifyEmailFilename("Hotel Booking — Paris!")).toBe("hotel-booking-paris");
    expect(slugifyEmailFilename("")).toBe("email");
  });
});

describe("exportGmailMessageToPdf", () => {
  beforeEach(() => {
    mocks.fetchGmailMessageContent.mockReset();
    mocks.buildMessageHtml.mockReset();
    mocks.renderHtmlToPdf.mockReset();
    mocks.mkdirSync.mockReset();
  });

  it("fetches content, builds html, renders pdf, and returns metadata", async () => {
    const content = {
      subject: "Hotel booking",
      from: "hotel@example.com",
      date: "Mon, 2 Jun 2026 10:00:00 +0000",
      payload: { mimeType: "text/html", body: { data: "abc" } },
    };
    mocks.fetchGmailMessageContent.mockResolvedValueOnce(content);
    mocks.buildMessageHtml.mockReturnValueOnce("<html>email</html>");
    mocks.renderHtmlToPdf.mockResolvedValueOnce(undefined);

    const account = { id: 1, status: "active" } as never;
    const result = await exportGmailMessageToPdf(account, "msg-1234567890");

    expect(mocks.mkdirSync).toHaveBeenCalledWith("/tmp/gmail-exports", { recursive: true });
    expect(mocks.buildMessageHtml).toHaveBeenCalledWith(content);
    expect(mocks.renderHtmlToPdf).toHaveBeenCalledWith(
      "<html>email</html>",
      "/tmp/gmail-exports/hotel-booking-msg-12345678.pdf",
    );
    expect(result).toEqual({
      filePath: "/tmp/gmail-exports/hotel-booking-msg-12345678.pdf",
      subject: "Hotel booking",
      from: "hotel@example.com",
      date: "Mon, 2 Jun 2026 10:00:00 +0000",
    });
  });
});
