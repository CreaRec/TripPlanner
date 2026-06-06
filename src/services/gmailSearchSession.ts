import type { GmailSearchOutput } from "./gmailSearch";
import { getAccountById } from "./gmailAccounts";
import { exportGmailMessageToPdf } from "./gmailExport";

const TTL_MS = 60 * 60 * 1000;

interface GmailSearchSessionEntry {
  at: number;
  data: GmailSearchOutput;
}

const sessions = new Map<number, GmailSearchSessionEntry>();

export function saveGmailSearchSession(telegramId: number, data: GmailSearchOutput): void {
  const existing = sessions.get(telegramId);
  if (
    data.messages.length === 0 &&
    existing &&
    Date.now() - existing.at <= TTL_MS &&
    existing.data.messages.length > 0
  ) {
    // Keep the prior numbered list when a follow-up search returns nothing (e.g. per-account check).
    return;
  }
  sessions.set(telegramId, { at: Date.now(), data });
}

export function getGmailSearchSession(telegramId: number): GmailSearchOutput | null {
  const entry = sessions.get(telegramId);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    sessions.delete(telegramId);
    return null;
  }
  return entry.data;
}

export function formatGmailSearchSessionContext(data: GmailSearchOutput): string {
  if (data.messages.length === 0) {
    return `Last Gmail search (query: ${data.query_used}): no messages found.`;
  }
  const lines = data.messages.map(
    (m, index) =>
      `${index + 1}. [gmail_account_id=${m.gmail_account_id}, message_id=${m.id}] ${m.subject} — ${m.from} (${m.account_email})`,
  );
  return [`Last Gmail search (query: ${data.query_used}):`, ...lines].join("\n");
}

export type ExportGmailBySearchIndexResult =
  | {
      ok: true;
      filePaths: string[];
      subject: string;
      index: number;
      attachmentCount: number;
      skippedAttachments: { filename: string; size: number; reason: "too_large" }[];
    }
  | { ok: false; reason: "no_session" }
  | { ok: false; reason: "invalid_index"; count: number }
  | { ok: false; reason: "account_unavailable" }
  | { ok: false; reason: "export_failed"; message: string };

export async function exportGmailBySearchIndex(
  telegramId: number,
  index: number,
): Promise<ExportGmailBySearchIndexResult> {
  const session = getGmailSearchSession(telegramId);
  if (!session || session.messages.length === 0) {
    return { ok: false, reason: "no_session" };
  }

  const message = session.messages[index - 1];
  if (!message) {
    return { ok: false, reason: "invalid_index", count: session.messages.length };
  }

  const account = await getAccountById(telegramId, message.gmail_account_id);
  if (!account || account.status !== "active") {
    return { ok: false, reason: "account_unavailable" };
  }

  try {
    const exported = await exportGmailMessageToPdf(account, message.id);
    return {
      ok: true,
      filePaths: [exported.filePath, ...exported.attachmentFiles],
      subject: exported.subject,
      index,
      attachmentCount: exported.attachmentFiles.length,
      skippedAttachments: exported.skippedAttachments,
    };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "export_failed", message: messageText };
  }
}

/** @internal Test helper */
export function clearGmailSearchSessions(): void {
  sessions.clear();
}
