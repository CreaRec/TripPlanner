import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailMessagePart } from "./gmailClient";

const mocks = vi.hoisted(() => ({
  fetchGmailAttachment: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: mocks.writeFileSync,
}));

vi.mock("./gmailClient", () => ({
  fetchGmailAttachment: mocks.fetchGmailAttachment,
}));

import {
  collectAttachmentParts,
  dedupeAttachmentFilenames,
  downloadGmailAttachments,
  GMAIL_ATTACHMENT_MAX_BYTES,
  sanitizeAttachmentFilename,
} from "./gmailAttachments";

describe("collectAttachmentParts", () => {
  it("collects file attachments and skips inline and body parts", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/html",
          body: { data: "abc" },
        },
        {
          mimeType: "image/png",
          filename: "logo.png",
          headers: [
            { name: "Content-Disposition", value: "inline" },
            { name: "Content-ID", value: "<logo@cid>" },
          ],
          body: { attachmentId: "att-inline", size: 100 },
        },
        {
          mimeType: "application/pdf",
          filename: "ticket.pdf",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "att-1", size: 2048 },
        },
      ],
    };

    expect(collectAttachmentParts(payload)).toEqual([
      {
        filename: "ticket.pdf",
        mimeType: "application/pdf",
        attachmentId: "att-1",
        size: 2048,
      },
    ]);
  });

  it("skips attachments larger than 10 MB during download", async () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "application/pdf",
          filename: "small.pdf",
          body: { attachmentId: "att-small", size: 1000 },
        },
        {
          mimeType: "application/zip",
          filename: "large.zip",
          body: { attachmentId: "att-large", size: GMAIL_ATTACHMENT_MAX_BYTES + 1 },
        },
      ],
    };

    mocks.fetchGmailAttachment.mockResolvedValueOnce(Buffer.alloc(1000));

    const result = await downloadGmailAttachments(
      { id: 1 } as never,
      "msg-1234567890",
      payload,
      "/tmp/exports",
    );

    expect(mocks.fetchGmailAttachment).toHaveBeenCalledTimes(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.filename).toBe("small.pdf");
    expect(result.skipped).toEqual([
      {
        filename: "large.zip",
        size: GMAIL_ATTACHMENT_MAX_BYTES + 1,
        reason: "too_large",
      },
    ]);
  });
});

describe("attachment filename helpers", () => {
  it("sanitizes unsafe filenames", () => {
    expect(sanitizeAttachmentFilename("../../evil.pdf")).toBe("evil.pdf");
    expect(sanitizeAttachmentFilename("")).toBe("attachment");
  });

  it("deduplicates repeated filenames", () => {
    expect(dedupeAttachmentFilenames(["ticket.pdf", "ticket.pdf", "photo"])).toEqual([
      "ticket.pdf",
      "ticket-2.pdf",
      "photo",
    ]);
  });
});

describe("downloadGmailAttachments", () => {
  beforeEach(() => {
    mocks.fetchGmailAttachment.mockReset();
    mocks.writeFileSync.mockReset();
  });

  it("downloads attachments with message id prefix", async () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "application/pdf",
          filename: "ticket.pdf",
          body: { attachmentId: "att-1", size: 500 },
        },
      ],
    };
    mocks.fetchGmailAttachment.mockResolvedValueOnce(Buffer.from("pdf-data"));

    const result = await downloadGmailAttachments(
      { id: 1 } as never,
      "msg-1234567890",
      payload,
      "/tmp/exports",
    );

    expect(mocks.fetchGmailAttachment).toHaveBeenCalledWith({ id: 1 }, "msg-1234567890", "att-1");
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      "/tmp/exports/msg-12345678-ticket.pdf",
      Buffer.from("pdf-data"),
    );
    expect(result.files).toEqual([
      { path: "/tmp/exports/msg-12345678-ticket.pdf", filename: "ticket.pdf" },
    ]);
    expect(result.skipped).toEqual([]);
  });
});
