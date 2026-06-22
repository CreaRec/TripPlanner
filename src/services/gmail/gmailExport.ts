import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { GmailAccount } from "@prisma/client";
import { config, isExportStorageConfigured } from "../../config";
import {
  downloadGmailAttachments,
  sanitizeAttachmentFilename,
  type SkippedGmailAttachment,
} from "./gmailAttachments";
import {
  getCachedGmailExport,
  gmailAttachmentKey,
  gmailExportPrefix,
  gmailPdfKey,
  invalidateExport,
  materializeForTelegram,
  storeExportFromFile,
  storeGmailExportManifest,
} from "../export/exportStorage";
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
  cached: boolean;
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
  options?: { forceRefresh?: boolean },
): Promise<GmailExportResult> {
  if (isExportStorageConfigured() && !options?.forceRefresh) {
    const cached = await getCachedGmailExport(account.id, messageId);
    if (cached) {
      const paths = await materializeForTelegram(cached.keys);
      return {
        filePath: paths[0]!,
        attachmentFiles: paths.slice(1),
        skippedAttachments: cached.manifest.skippedAttachments,
        subject: cached.manifest.subject,
        from: cached.manifest.from,
        date: cached.manifest.date,
        cached: true,
      };
    }
  }

  if (isExportStorageConfigured() && options?.forceRefresh) {
    await invalidateExport(gmailExportPrefix(account.id, messageId));
  }

  const content = await fetchGmailMessageContent(account, messageId);
  const html = buildMessageHtml(content);
  const dir = ensureExportDir();
  const localPdf = join(dir, `${slugifyEmailFilename(content.subject)}-${messageId.slice(0, 12)}.pdf`);
  await renderHtmlToPdf(html, localPdf);

  const attachments = await downloadGmailAttachments(
    account,
    messageId,
    content.payload,
    dir,
  );

  if (isExportStorageConfigured()) {
    const pdfKey = gmailPdfKey(account.id, messageId);
    await storeExportFromFile(pdfKey, localPdf, "application/pdf");

    const attachmentKeys: string[] = [];
    for (const file of attachments.files) {
      const sanitized = sanitizeAttachmentFilename(basename(file.path));
      const key = gmailAttachmentKey(account.id, messageId, sanitized);
      await storeExportFromFile(key, file.path, "application/octet-stream");
      attachmentKeys.push(key);
    }

    await storeGmailExportManifest(account.id, messageId, {
      pdfKey,
      attachmentKeys,
      skippedAttachments: attachments.skipped,
      subject: content.subject,
      from: content.from,
      date: content.date,
    });
  }

  return {
    filePath: localPdf,
    attachmentFiles: attachments.files.map((file) => file.path),
    skippedAttachments: attachments.skipped,
    subject: content.subject,
    from: content.from,
    date: content.date,
    cached: false,
  };
}
