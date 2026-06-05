import type { GmailAccount } from "@prisma/client";
import { google } from "googleapis";
import { config, GMAIL_READONLY_SCOPE } from "../config";
import { decrypt } from "./tokenCrypto";
import { markAccountInvalid, updateAccountTokens } from "./gmailAccounts";

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string | null;
  snippet: string;
}

export interface GmailMessageRawExport {
  raw: Buffer;
  subject: string;
  from: string;
  date: string | null;
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    config.googleOAuthClientId,
    config.googleOAuthClientSecret,
    config.googleOAuthRedirectUri,
  );
}

function isInvalidGrantError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /invalid_grant|Token has been expired or revoked/i.test(message);
}

async function refreshAccessToken(account: GmailAccount): Promise<string> {
  const oauth2 = createOAuthClient();
  oauth2.setCredentials({
    refresh_token: decrypt(account.refreshTokenEnc),
  });

  try {
    const { credentials } = await oauth2.refreshAccessToken();
    const accessToken = credentials.access_token;
    if (!accessToken) {
      throw new Error("Google did not return a new access token.");
    }
    const expiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600 * 1000);
    await updateAccountTokens(account.id, {
      accessToken,
      tokenExpiresAt: expiresAt,
    });
    return accessToken;
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await markAccountInvalid(account.id);
    }
    throw err;
  }
}

async function getAccessToken(account: GmailAccount): Promise<string> {
  const bufferMs = 60_000;
  if (account.tokenExpiresAt.getTime() - bufferMs > Date.now()) {
    return decrypt(account.accessTokenEnc);
  }
  return refreshAccessToken(account);
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

async function createAuthenticatedGmail(account: GmailAccount) {
  const accessToken = await getAccessToken(account);
  const oauth2 = createOAuthClient();
  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: decrypt(account.refreshTokenEnc),
    scope: GMAIL_READONLY_SCOPE,
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
): string {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() ?? "";
}

export async function fetchGmailMessageRaw(
  account: GmailAccount,
  messageId: string,
): Promise<GmailMessageRawExport> {
  const gmail = await createAuthenticatedGmail(account);
  let rawResponse;
  let metaResponse;
  try {
    [rawResponse, metaResponse] = await Promise.all([
      gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "raw",
      }),
      gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      }),
    ]);
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await markAccountInvalid(account.id);
    }
    throw err;
  }

  const rawData = rawResponse.data.raw;
  if (!rawData) {
    throw new Error("Gmail did not return raw message content.");
  }

  const headers = metaResponse.data.payload?.headers;
  const internalDate = metaResponse.data.internalDate
    ? new Date(Number(metaResponse.data.internalDate)).toISOString()
    : null;

  return {
    raw: decodeBase64Url(rawData),
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From") || "(unknown sender)",
    date: headerValue(headers, "Date") || internalDate,
  };
}

export async function listMessagesForAccount(
  account: GmailAccount,
  options: { q: string; maxResults: number },
): Promise<GmailMessageSummary[]> {
  const gmail = await createAuthenticatedGmail(account);
  let listResponse;
  try {
    listResponse = await gmail.users.messages.list({
      userId: "me",
      q: options.q,
      maxResults: options.maxResults,
    });
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await markAccountInvalid(account.id);
    }
    throw err;
  }

  const messageIds = listResponse.data.messages ?? [];
  const summaries: GmailMessageSummary[] = [];

  for (const ref of messageIds) {
    if (!ref.id) continue;
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });
    const headers = detail.data.payload?.headers;
    const internalDate = detail.data.internalDate
      ? new Date(Number(detail.data.internalDate)).toISOString()
      : null;
    summaries.push({
      id: detail.data.id ?? ref.id,
      threadId: detail.data.threadId ?? ref.id,
      subject: headerValue(headers, "Subject") || "(no subject)",
      from: headerValue(headers, "From") || "(unknown sender)",
      date: headerValue(headers, "Date") || internalDate,
      snippet: detail.data.snippet ?? "",
    });
  }

  return summaries;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const oauth2 = createOAuthClient();
  oauth2.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) {
    throw new Error("Could not read Google account email from Gmail profile.");
  }
  return email.toLowerCase();
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scopes: string;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("Google OAuth did not return access and refresh tokens.");
  }
  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + 3600 * 1000);
  return {
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
    scopes: tokens.scope ?? GMAIL_READONLY_SCOPE,
  };
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const oauth2 = createOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state,
  });
}
