import { describe, expect, it, vi } from "vitest";
import { request } from "node:http";

vi.mock("../config", () => ({
  config: { httpPort: 0, publicAppUrl: "https://example.com" },
  isGmailOAuthConfigured: () => true,
  OAUTH_PUBLIC_PATH: "/trip-planner/oauth",
}));

const oauthMocks = vi.hoisted(() => ({
  validateOAuthState: vi.fn(),
  consumeOAuthState: vi.fn(),
  createOAuthState: vi.fn(),
  purgeExpiredOAuthStates: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  fetchGoogleEmail: vi.fn(),
  buildGoogleAuthorizeUrl: vi.fn(),
  upsertAccount: vi.fn(),
}));

vi.mock("../services/gmail/oauthState", () => ({
  GOOGLE_GMAIL_PROVIDER: "google_gmail",
  validateOAuthState: oauthMocks.validateOAuthState,
  consumeOAuthState: oauthMocks.consumeOAuthState,
  createOAuthState: oauthMocks.createOAuthState,
  purgeExpiredOAuthStates: oauthMocks.purgeExpiredOAuthStates,
}));
vi.mock("../services/gmail/gmailClient", () => ({
  exchangeCodeForTokens: oauthMocks.exchangeCodeForTokens,
  fetchGoogleEmail: oauthMocks.fetchGoogleEmail,
  buildGoogleAuthorizeUrl: oauthMocks.buildGoogleAuthorizeUrl,
}));
vi.mock("../services/gmail/gmailAccounts", () => ({
  upsertAccount: oauthMocks.upsertAccount,
}));

import { createHttpServer, startConnectFlow } from "./server";

function httpGet(port: number, path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("http server", () => {
  it("returns health ok", async () => {
    const server = createHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const res = await httpGet(port, "/health");
    server.close();
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("shows a Continue button on /oauth/google/start without consuming state", async () => {
    oauthMocks.validateOAuthState.mockResolvedValueOnce({ telegramId: 111 });
    oauthMocks.buildGoogleAuthorizeUrl.mockReturnValueOnce(
      "https://accounts.google.com/o/oauth2/auth?state=initial-state",
    );

    const server = createHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const res = await httpGet(port, "/oauth/google/start?state=initial-state");
    server.close();

    expect(res.status).toBe(200);
    expect(res.body).toContain("Continue with Google");
    expect(res.body).toContain("accounts.google.com");
    expect(oauthMocks.validateOAuthState).toHaveBeenCalledWith("initial-state", "google_gmail");
    expect(oauthMocks.consumeOAuthState).not.toHaveBeenCalled();
    expect(oauthMocks.buildGoogleAuthorizeUrl).toHaveBeenCalledWith("initial-state");
  });

  it("upserts gmail account on callback", async () => {
    oauthMocks.consumeOAuthState.mockResolvedValueOnce({ telegramId: 111 });
    oauthMocks.exchangeCodeForTokens.mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiresAt: new Date(),
      scopes: "gmail.readonly",
    });
    oauthMocks.fetchGoogleEmail.mockResolvedValueOnce("user@gmail.com");
    oauthMocks.upsertAccount.mockResolvedValueOnce({ id: 1 });

    const server = createHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const res = await httpGet(port, "/oauth/google/callback?code=abc&state=state-1");
    server.close();

    expect(res.status).toBe(200);
    expect(res.body).toContain("user@gmail.com");
    expect(oauthMocks.upsertAccount).toHaveBeenCalledWith(
      111,
      "user@gmail.com",
      expect.objectContaining({ accessToken: "access" }),
    );
  });

  it("startConnectFlow returns public oauth start link", async () => {
    oauthMocks.createOAuthState.mockResolvedValueOnce("link-state");
    const url = await startConnectFlow(111);
    expect(url).toBe("https://example.com/trip-planner/oauth/google/start?state=link-state");
  });
});
