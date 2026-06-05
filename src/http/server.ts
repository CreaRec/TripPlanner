import type { Server } from "node:http";
import { createServer } from "node:http";
import { URL } from "node:url";
import { config, isGmailOAuthConfigured } from "../config";
import {
  consumeOAuthState,
  createOAuthState,
  GOOGLE_GMAIL_PROVIDER,
  purgeExpiredOAuthStates,
  validateOAuthState,
} from "../services/oauthState";
import {
  buildGoogleAuthorizeUrl,
  exchangeCodeForTokens,
  fetchGoogleEmail,
} from "../services/gmailClient";
import { upsertAccount } from "../services/gmailAccounts";
import { buildOAuthStartUrl } from "../services/gmailUrls";

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
    .ok { color: #0a7; }
    .err { color: #c00; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function sendHtml(res: import("node:http").ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendText(res: import("node:http").ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleGoogleStart(
  url: URL,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const state = url.searchParams.get("state");
  if (!state) {
    sendHtml(res, 400, htmlPage("Invalid request", "<p class=\"err\">Missing OAuth state.</p>"));
    return;
  }

  const validated = await validateOAuthState(state, GOOGLE_GMAIL_PROVIDER);
  if (!validated) {
    sendHtml(
      res,
      400,
      htmlPage(
        "Link expired",
        '<p class="err">This connection link expired or was already used. In Telegram, say "connect gmail" or "подключить почту" again.</p>',
      ),
    );
    return;
  }

  // HTML interstitial (not an immediate redirect): Telegram link previews fetch the URL
  // and would burn a one-time state if we consumed or redirected here.
  const authorizeUrl = buildGoogleAuthorizeUrl(state);
  sendHtml(
    res,
    200,
    htmlPage(
      "Connect Gmail",
      [
        "<p>Tap the button below to connect your Gmail account to Crea Trip Planner.</p>",
        `<p><a href="${escapeHtml(authorizeUrl)}" style="display:inline-block;padding:0.75rem 1.25rem;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;">Continue with Google</a></p>`,
        "<p style=\"color:#666;font-size:0.9rem;\">If you did not request this, close this page.</p>",
      ].join("\n"),
    ),
  );
}

async function handleGoogleCallback(
  url: URL,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const error = url.searchParams.get("error");
  if (error) {
    sendHtml(
      res,
      400,
      htmlPage("Connection cancelled", `<p class="err">Google OAuth error: ${error}</p>`),
    );
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    sendHtml(res, 400, htmlPage("Invalid callback", "<p class=\"err\">Missing code or state.</p>"));
    return;
  }

  const consumed = await consumeOAuthState(state, GOOGLE_GMAIL_PROVIDER);
  if (!consumed) {
    sendHtml(
      res,
      400,
      htmlPage(
        "Link expired",
        '<p class="err">OAuth state expired. In Telegram, say "connect gmail" or "подключить почту" again.</p>',
      ),
    );
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const googleEmail = await fetchGoogleEmail(tokens.accessToken);
    await upsertAccount(consumed.telegramId, googleEmail, tokens);
    sendHtml(
      res,
      200,
      htmlPage(
        "Gmail connected",
        `<p class="ok"><strong>${googleEmail}</strong> is connected to Crea Trip Planner.</p><p>Return to Telegram and ask which inboxes are connected to verify.</p>`,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[oauth] callback failed:", message);
    sendHtml(
      res,
      500,
      htmlPage("Connection failed", `<p class="err">${message}</p>`),
    );
  }
}

export function createHttpServer(): Server {
  if (!isGmailOAuthConfigured()) {
    throw new Error("Gmail OAuth is not configured.");
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!req.url) {
          sendText(res, 400, "Bad request");
          return;
        }

        const host = req.headers.host ?? `localhost:${config.httpPort}`;
        const url = new URL(req.url, `http://${host}`);
        const path = url.pathname;

        if (req.method === "GET" && path === "/health") {
          sendText(res, 200, "ok");
          return;
        }

        if (req.method === "GET" && path === "/oauth/google/start") {
          await handleGoogleStart(url, res);
          return;
        }

        if (req.method === "GET" && path === "/oauth/google/callback") {
          await handleGoogleCallback(url, res);
          return;
        }

        sendText(res, 404, "Not found");
      } catch (err) {
        console.error("[http] request failed:", err);
        sendText(res, 500, "Internal server error");
      }
    })();
  });

  return server;
}

export async function startConnectFlow(telegramId: number): Promise<string> {
  await purgeExpiredOAuthStates();
  const state = await createOAuthState(telegramId, GOOGLE_GMAIL_PROVIDER);
  if (!config.publicAppUrl) {
    throw new Error("PUBLIC_APP_URL is not configured.");
  }
  return buildOAuthStartUrl(state, config.publicAppUrl);
}
