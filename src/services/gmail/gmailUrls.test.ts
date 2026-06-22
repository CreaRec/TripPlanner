import { describe, expect, it } from "vitest";
import { buildOAuthStartUrl, normalizePublicAppUrl } from "./gmailUrls";

describe("gmailUrls", () => {
  it("builds oauth start url", () => {
    expect(buildOAuthStartUrl("abc", "https://example.com")).toBe(
      "https://example.com/trip-planner/oauth/google/start?state=abc",
    );
  });

  it("normalizes PUBLIC_APP_URL with a /trip-planner suffix", () => {
    expect(normalizePublicAppUrl("https://crearec.app/trip-planner/")).toBe("https://crearec.app");
    expect(buildOAuthStartUrl("state-1", "https://crearec.app/trip-planner/")).toBe(
      "https://crearec.app/trip-planner/oauth/google/start?state=state-1",
    );
  });
});
