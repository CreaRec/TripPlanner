import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GmailAccount } from "@prisma/client";
import { config } from "../config";
import { downloadGmailAttachments, type SkippedGmailAttachment } from "./gmailAttachments";
import { fetchGmailMessageContent } from "./gmailClient";
import { buildMessageHtml } from "./gmailMessageHtml";
import { renderHtmlToPdf } from "./gmailPdf";

export interface GmailExportResult {
  filePath: string;
  attachmentFiles: string[];
  skippedAttachments: SkippedGmailAttachment[];
  subject: string;
  from: string;
  date: string | null;
}

export function formatSkippedAttachmentsNote(
  skipped: SkippedGmailAttachment[],
): string {
  if (skipped.length === 0) return "";
  const lines = skipped.map((item) => {
    const sizeMb = (item.size / (1024 * 1024)).toFixed(1);
    return `${item.filename} (${sizeMb} МБ)`;
  });
  return `\n\nНе отправлены вложения больше 10 МБ: ${lines.join(", ")}. Откройте их в Gmail.`;
}

export function formatGmailExportSuccessMessage(options: {
  index?: number;
  attachmentCount: number;
  skippedAttachments: SkippedGmailAttachment[];
}): string {
  const indexPart = options.index ? `письма ${options.index}` : "письма";
  const attachmentPart =
    options.attachmentCount > 0
      ? ` и ${options.attachmentCount} ${options.attachmentCount === 1 ? "вложение" : "вложения"}`
      : "";
  const base = `Готово — PDF ${indexPart} прикреплён${attachmentPart}. Можно открыть прямо в Telegram.`;
  return `${base}${formatSkippedAttachmentsNote(options.skippedAttachments)}`;
}

export function buildGmailExportInstruction(
  skippedAttachments: SkippedGmailAttachment[],
  attachmentCount: number,
): string {
  const attachmentNote =
    attachmentCount > 0
      ? ` ${attachmentCount} attachment file(s) are also attached.`
      : "";
  const skippedNote =
    skippedAttachments.length > 0
      ? ` Tell the user these attachments were skipped because they exceed 10 MB: ${skippedAttachments
          .map((item) => item.filename)
          .join(", ")}. They should open those files in Gmail.`
      : "";
  return `Tell the user the PDF file is attached.${attachmentNote} They can open files directly in Telegram or any viewer. Do not paste the email body in the chat.${skippedNote}`;
}

export function slugifyEmailFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "email"
  );
}

function ensureExportDir(): string {
  const dir = resolve(config.dataDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function exportGmailMessageToPdf(
  account: GmailAccount,
  messageId: string,
): Promise<GmailExportResult> {
  const content = await fetchGmailMessageContent(account, messageId);
  const html = buildMessageHtml(content);
  const dir = ensureExportDir();
  const filename = join(dir, `${slugifyEmailFilename(content.subject)}-${messageId.slice(0, 12)}.pdf`);
  await renderHtmlToPdf(html, filename);

  const attachments = await downloadGmailAttachments(
    account,
    messageId,
    content.payload,
    dir,
  );

  return {
    filePath: filename,
    attachmentFiles: attachments.files.map((file) => file.path),
    skippedAttachments: attachments.skipped,
    subject: content.subject,
    from: content.from,
    date: content.date,
  };
}
