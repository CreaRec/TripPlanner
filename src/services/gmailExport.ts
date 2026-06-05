import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GmailAccount } from "@prisma/client";
import { config } from "../config";
import { fetchGmailMessageRaw } from "./gmailClient";

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

export async function exportGmailMessageToEml(
  account: GmailAccount,
  messageId: string,
): Promise<GmailExportResult> {
  const { raw, subject, from, date } = await fetchGmailMessageRaw(account, messageId);
  const dir = ensureExportDir();
  const filename = join(dir, `${slugifyEmailFilename(subject)}-${messageId.slice(0, 12)}.eml`);
  writeFileSync(filename, raw);
  return { filePath: filename, subject, from, date };
}
