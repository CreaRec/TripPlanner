const CONNECT_VERBS =
  /(?:^|\s)(?:подключ(?:и|ить)|привяз(?:и|ать)|добав(?:ь|ить|ьте|лять)|connect|link|add)(?:\s|$)/iu;
const MAIL_NOUNS =
  /(?:почт(?:у|а|ы|е)?|gmail|e-?mail|mail(?:box)?|ящик|аккаунт|account|inbox)/iu;
const SEARCH_VERBS = /(?:найди|найти|поиск|search|find|ищи|искать)/iu;
const BARE_GMAIL_ADDRESS = /^\s*[\w.+-]+@gmail\.com\s*$/iu;
const EXPORT_BY_NUMBER =
  /^(?:дай|покажи|открой|экспортируй|export|open|show|get|send)?\s*(?:мне\s+)?(?:письмо|email|e-?mail|mail|message)\s*#?\s*(\d+)\s*[.!?]*$/iu;

/** True when the user wants to link a Gmail inbox (not search mail). */
export function isConnectGmailRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  if (SEARCH_VERBS.test(trimmed) && MAIL_NOUNS.test(trimmed)) return false;
  if (BARE_GMAIL_ADDRESS.test(trimmed)) return true;
  return CONNECT_VERBS.test(trimmed) && MAIL_NOUNS.test(trimmed);
}

/** 1-based index from "дай письмо 2" / "email 3" style export requests. */
export function parseExportGmailByNumberRequest(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return null;

  const match = trimmed.match(EXPORT_BY_NUMBER);
  if (!match) return null;

  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 ? index : null;
}
