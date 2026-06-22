import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../../config";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const raw = config.oauthTokenEncryptionKey;
  if (!raw) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).");
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted token payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
