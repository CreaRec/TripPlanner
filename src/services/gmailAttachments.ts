import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GmailAccount } from "@prisma/client";
import { fetchGmailAttachment, type GmailMessagePart } from "./gmailClient";
import { partHeader, walkGmailParts } from "./gmailMime";

export const GMAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface GmailAttachmentPart {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface SkippedGmailAttachment {
  filename: string;
  size: number;
  reason: "too_large";
}

export interface DownloadedGmailAttachment {
  path: string;
  filename: string;
}

export interface DownloadGmailAttachmentsResult {
  files: DownloadedGmailAttachment[];
  skipped: SkippedGmailAttachment[];
}

function isInlinePart(part: GmailMessagePart): boolean {
  const disposition = partHeader(part.headers ?? undefined, "Content-Disposition").toLowerCase();
  const contentId = partHeader(part.headers ?? undefined, "Content-ID");
  return disposition.startsWith("inline") && Boolean(contentId);
}

function isMessageBodyPart(part: GmailMessagePart): boolean {
  const mimeType = part.mimeType?.toLowerCase() ?? "";
  const filename = part.filename?.trim() ?? "";
  return !filename && (mimeType === "text/html" || mimeType === "text/plain");
}

export function collectAttachmentParts(
  payload: GmailMessagePart | null | undefined,
): GmailAttachmentPart[] {
  const attachments: GmailAttachmentPart[] = [];

  walkGmailParts(payload, (part) => {
    const filename = part.filename?.trim();
    const attachmentId = part.body?.attachmentId?.trim();
    if (!filename || !attachmentId) return;
    if (isInlinePart(part)) return;
    if (isMessageBodyPart(part)) return;

    attachments.push({
      filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      attachmentId,
      size: part.body?.size ?? 0,
    });
  });

  return attachments;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  const sanitized = base
    .replace(/\.\.+/g, ".")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return sanitized || "attachment";
}

export function dedupeAttachmentFilenames(filenames: string[]): string[] {
  const counts = new Map<string, number>();
  return filenames.map((name) => {
    const count = counts.get(name) ?? 0;
    counts.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      return `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
    }
    return `${name}-${count + 1}`;
  });
}

export async function downloadGmailAttachments(
  account: GmailAccount,
  messageId: string,
  payload: GmailMessagePart | null | undefined,
  exportDir: string,
): Promise<DownloadGmailAttachmentsResult> {
  const parts = collectAttachmentParts(payload);
  const messagePrefix = messageId.slice(0, 12);
  const sanitizedNames = dedupeAttachmentFilenames(parts.map((p) => sanitizeAttachmentFilename(p.filename)));
  const files: DownloadedGmailAttachment[] = [];
  const skipped: SkippedGmailAttachment[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const sanitized = sanitizedNames[i]!;

    if (part.size > GMAIL_ATTACHMENT_MAX_BYTES) {
      skipped.push({ filename: part.filename, size: part.size, reason: "too_large" });
      continue;
    }

    const uniqueName = `${messagePrefix}-${sanitized}`;
    const path = join(exportDir, uniqueName);
    const buffer = await fetchGmailAttachment(account, messageId, part.attachmentId);

    if (buffer.length > GMAIL_ATTACHMENT_MAX_BYTES) {
      skipped.push({ filename: part.filename, size: buffer.length, reason: "too_large" });
      continue;
    }

    writeFileSync(path, buffer);
    files.push({ path, filename: part.filename });
  }

  return { files, skipped };
}
