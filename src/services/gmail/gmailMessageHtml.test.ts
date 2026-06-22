import { describe, expect, it } from "vitest";
import { buildMessageHtml, type GmailMessagePart } from "./gmailMessageHtml";

function encodeBody(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

describe("buildMessageHtml", () => {
  it("wraps html body with headers", () => {
    const payload: GmailMessagePart = {
      mimeType: "text/html",
      body: { data: encodeBody("<p>Booking confirmed</p>") },
      headers: [
        { name: "Subject", value: "Hotel Paris" },
        { name: "From", value: "hotel@example.com" },
        { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" },
      ],
    };

    const html = buildMessageHtml({
      subject: "Hotel Paris",
      from: "hotel@example.com",
      date: "Mon, 1 Jan 2024 10:00:00 +0000",
      payload,
    });

    expect(html).toContain("<h1>Hotel Paris</h1>");
    expect(html).toContain("hotel@example.com");
    expect(html).toContain("<p>Booking confirmed</p>");
  });

  it("falls back to plain text when no html part exists", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: encodeBody("Plain body line") },
        },
      ],
    };

    const html = buildMessageHtml({
      subject: "Plain only",
      from: "sender@example.com",
      date: null,
      payload,
    });

    expect(html).toContain("<pre");
    expect(html).toContain("Plain body line");
  });

  it("inlines cid images as data uris", () => {
    const pngBase64 = Buffer.from("fakepng").toString("base64url");
    const payload: GmailMessagePart = {
      mimeType: "multipart/related",
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: encodeBody('<img src="cid:logo123">'),
          },
        },
        {
          mimeType: "image/png",
          headers: [{ name: "Content-ID", value: "<logo123>" }],
          body: { data: pngBase64 },
        },
      ],
    };

    const html = buildMessageHtml({
      subject: "With logo",
      from: "sender@example.com",
      date: null,
      payload,
    });

    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("cid:logo123");
  });
});
