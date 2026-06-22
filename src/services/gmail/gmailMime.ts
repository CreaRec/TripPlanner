import type { GmailMessagePart } from "./gmailClient";

export function partHeader(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
): string {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() ?? "";
}

export function walkGmailParts(
  part: GmailMessagePart | null | undefined,
  visit: (part: GmailMessagePart) => void,
): void {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) {
    walkGmailParts(child, visit);
  }
}
