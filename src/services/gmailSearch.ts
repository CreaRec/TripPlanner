import type { GmailAccount } from "@prisma/client";
import { listMessagesForAccount } from "./gmailClient";

export interface GmailSearchMessageResult {
  gmail_account_id: number;
  account_email: string;
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  date: string | null;
  snippet: string;
}

export interface GmailSearchOutput {
  accounts_searched: string[];
  query_used: string;
  messages: GmailSearchMessageResult[];
  account_errors?: { account_email: string; error: string }[];
}

function parseMessageDate(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function searchGmailAccounts(
  accounts: GmailAccount[],
  options: { q: string; maxResults: number },
): Promise<GmailSearchOutput> {
  const perAccountLimit = Math.max(1, Math.ceil(options.maxResults / Math.max(accounts.length, 1)));
  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const messages = await listMessagesForAccount(account, {
          q: options.q,
          maxResults: perAccountLimit,
        });
        return { account, messages, error: null as string | null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { account, messages: [], error: message };
      }
    }),
  );

  const merged: GmailSearchMessageResult[] = [];
  const accountErrors: { account_email: string; error: string }[] = [];

  for (const result of results) {
    if (result.error) {
      accountErrors.push({ account_email: result.account.googleEmail, error: result.error });
      continue;
    }
    for (const message of result.messages) {
      merged.push({
        gmail_account_id: result.account.id,
        account_email: result.account.googleEmail,
        id: message.id,
        thread_id: message.threadId,
        subject: message.subject,
        from: message.from,
        date: message.date,
        snippet: message.snippet,
      });
    }
  }

  merged.sort((a, b) => parseMessageDate(b.date) - parseMessageDate(a.date));

  const seen = new Set<string>();
  const deduped: GmailSearchMessageResult[] = [];
  for (const message of merged) {
    const key = `${message.account_email}:${message.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
    if (deduped.length >= options.maxResults) break;
  }

  return {
    accounts_searched: accounts.map((a) => a.googleEmail),
    query_used: options.q,
    messages: deduped,
    ...(accountErrors.length > 0 ? { account_errors: accountErrors } : {}),
  };
}
