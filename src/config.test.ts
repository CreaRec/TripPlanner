import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a comma/space separated whitelist", async () => {
    vi.stubEnv("ALLOWED_TELEGRAM_IDS", " 111 , 222 ");
    const { config } = await import("./config");
    expect(config.allowedTelegramIds).toEqual([111, 222]);
  });

  it("uses configured model names and defaults vision to the chat model", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("OPENAI_VISION_MODEL", undefined);
    vi.stubEnv("EMBEDDING_MODEL", "text-embedding-3-small");
    const { config } = await import("./config");
    expect(config.openaiModel).toBe("gpt-4o-mini");
    expect(config.openaiVisionModel).toBe("gpt-4o-mini");
    expect(config.embeddingModel).toBe("text-embedding-3-small");
  });

  it("allows the vision model to be configured separately", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("OPENAI_VISION_MODEL", "gpt-4.1-mini");
    const { config } = await import("./config");
    expect(config.openaiVisionModel).toBe("gpt-4.1-mini");
  });

  it("treats an empty whitelist as no restriction", async () => {
    vi.stubEnv("ALLOWED_TELEGRAM_IDS", "");
    const { config } = await import("./config");
    expect(config.allowedTelegramIds).toEqual([]);
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await expect(import("./config")).rejects.toBeTruthy();
  });

  it("throws on a non-numeric whitelist id", async () => {
    vi.stubEnv("ALLOWED_TELEGRAM_IDS", "111,abc");
    await expect(import("./config")).rejects.toThrow(/non-numeric/);
  });

  it("detects configured Gmail OAuth", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://example.com/trip-planner/oauth/google/callback");
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    vi.stubEnv("PUBLIC_APP_URL", "https://example.com");
    vi.stubEnv("HTTP_PORT", "3001");
    const { config, isGmailOAuthConfigured } = await import("./config");
    expect(config.httpPort).toBe(3001);
    expect(isGmailOAuthConfigured()).toBe(true);
  });
});
