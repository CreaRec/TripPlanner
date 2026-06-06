import { decodeBase64Url, type GmailMessagePart } from "./gmailClient";
import { partHeader, walkGmailParts } from "./gmailMime";

export type { GmailMessagePart };

export interface GmailMessageHtmlInput {
  subject: string;
  from: string;
  date: string | null;
  payload: GmailMessagePart | null | undefined;
}

function decodePartBody(part: GmailMessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  return decodeBase64Url(data).toString("utf8");
}

function normalizeContentId(value: string): string {
  return value.replace(/^<|>$/g, "").trim().toLowerCase();
}

function buildInlineImageMap(payload: GmailMessagePart | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  walkGmailParts(payload, (part) => {
    const mimeType = part.mimeType?.toLowerCase() ?? "";
    if (!mimeType.startsWith("image/")) return;
    const contentId = partHeader(part.headers ?? undefined, "Content-ID");
    if (!contentId) return;
    const data = part.body?.data;
    if (!data) return;
    const base64 = decodeBase64Url(data).toString("base64");
    map.set(normalizeContentId(contentId), `data:${mimeType};base64,${base64}`);
  });
  return map;
}

function replaceCidReferences(html: string, inlineImages: Map<string, string>): string {
  return html.replace(/cid:([^"'\s>]+)/gi, (match, cid: string) => {
    const resolved = inlineImages.get(normalizeContentId(cid));
    return resolved ?? match;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectBodies(payload: GmailMessagePart | null | undefined): { html: string[]; plain: string[] } {
  const html: string[] = [];
  const plain: string[] = [];
  walkGmailParts(payload, (part) => {
    const mimeType = part.mimeType?.toLowerCase() ?? "";
    if (mimeType === "text/html") {
      const body = decodePartBody(part);
      if (body) html.push(body);
    } else if (mimeType === "text/plain") {
      const body = decodePartBody(part);
      if (body) plain.push(body);
    }
  });
  return { html, plain };
}

function extractBodyHtml(payload: GmailMessagePart | null | undefined): string {
  const inlineImages = buildInlineImageMap(payload);
  const { html, plain } = collectBodies(payload);
  if (html.length > 0) {
    return replaceCidReferences(html.join("\n"), inlineImages);
  }
  if (plain.length > 0) {
    return `<pre style="white-space:pre-wrap;font-family:monospace">${escapeHtml(plain.join("\n\n"))}</pre>`;
  }
  return "<p>(empty message)</p>";
}

export function buildMessageHtml(content: GmailMessageHtmlInput): string {
  const bodyHtml = extractBodyHtml(content.payload);
  const subject = escapeHtml(content.subject);
  const from = escapeHtml(content.from);
  const date = escapeHtml(content.date ?? "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; }
    .meta { border-bottom: 1px solid #ddd; margin-bottom: 16px; padding-bottom: 12px; }
    .meta h1 { font-size: 18px; margin: 0 0 8px; }
    .meta p { margin: 4px 0; font-size: 13px; color: #444; }
    .body { font-size: 14px; line-height: 1.5; }
    .body img { max-width: 100%; height: auto; }
    .body table { max-width: 100%; }
  </style>
</head>
<body>
  <div class="meta">
    <h1>${subject}</h1>
    <p><strong>From:</strong> ${from}</p>
    ${date ? `<p><strong>Date:</strong> ${date}</p>` : ""}
  </div>
  <div class="body">${bodyHtml}</div>
</body>
</html>`;
}
