import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config", () => ({
  config: {
    oauthTokenEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

import { decrypt, encrypt } from "./tokenCrypto";

describe("tokenCrypto", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("round-trips plaintext", () => {
    const original = "ya29.access-token-example";
    const payload = encrypt(original);
    expect(payload).not.toContain(original);
    expect(decrypt(payload)).toBe(original);
  });

  it("produces different ciphertext for the same input", () => {
    const a = encrypt("same-token");
    const b = encrypt("same-token");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-token");
    expect(decrypt(b)).toBe("same-token");
  });
});
