import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GmailAccount } from "@prisma/client";
import { config } from "../config";
import { fetchGmailMessageContent } from "./gmailClient";
import { buildMessageHtml } from "./gmailMessageHtml";
import { renderHtmlToPdf } from "./gmailPdf";

export interface GmailExportResult {
  filePath: string;
  subject: string;
  from: string;
  date: string | null;
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
  return {
    filePath: filename,
    subject: content.subject,
    from: content.from,
    date: content.date,
  };
}
