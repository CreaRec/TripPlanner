import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ quiet: true });

function envForSchema(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}

function optionalPositiveInt(defaultValue: number) {
  return z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return undefined;
      const n = Number(val);
      return Number.isFinite(n) ? n : undefined;
    },
    z.number().int().positive().default(defaultValue),
  );
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) {
        throw new Error(`ALLOWED_TELEGRAM_IDS contains a non-numeric id: "${s}"`);
      }
      return n;
    });
}

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ALLOWED_TELEGRAM_IDS: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_VISION_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  AVIATIONSTACK_API_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  OAUTH_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATA_DIR: z.string().default("./data/exports"),
  BOT_HANDLER_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  CHROMIUM_EXECUTABLE_PATH: z.string().default("/usr/bin/chromium"),
  AWS_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  EXPORT_CACHE_MAX_AGE_DAYS: optionalPositiveInt(30),
  EXPORT_BUCKET_MAX_BYTES: optionalPositiveInt(4_294_967_296),
  EXPORT_RETENTION_INTERVAL_MS: optionalPositiveInt(86_400_000),
});

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramIds: number[];
  openaiApiKey: string;
  openaiModel: string;
  openaiVisionModel: string;
  embeddingModel: string;
  googleMapsApiKey?: string;
  aviationStackApiKey?: string;
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthRedirectUri?: string;
  oauthTokenEncryptionKey?: string;
  publicAppUrl?: string;
  httpPort: number;
  databaseUrl: string;
  dataDir: string;
  botHandlerTimeoutMs: number;
  chromiumExecutablePath: string;
  awsRegion?: string;
  s3Bucket?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  exportCacheMaxAgeDays: number;
  exportBucketMaxBytes: number;
  exportRetentionIntervalMs: number;
}

function build(): AppConfig {
  const parsed = schema.parse(envForSchema());
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedTelegramIds: parseIds(parsed.ALLOWED_TELEGRAM_IDS),
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiModel: parsed.OPENAI_MODEL,
    openaiVisionModel: parsed.OPENAI_VISION_MODEL ?? parsed.OPENAI_MODEL,
    embeddingModel: parsed.EMBEDDING_MODEL,
    googleMapsApiKey: parsed.GOOGLE_MAPS_API_KEY,
    aviationStackApiKey: parsed.AVIATIONSTACK_API_KEY,
    googleOAuthClientId: parsed.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: parsed.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOAuthRedirectUri: parsed.GOOGLE_OAUTH_REDIRECT_URI,
    oauthTokenEncryptionKey: parsed.OAUTH_TOKEN_ENCRYPTION_KEY,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    httpPort: parsed.HTTP_PORT,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: parsed.DATA_DIR,
    botHandlerTimeoutMs: parsed.BOT_HANDLER_TIMEOUT_MS,
    chromiumExecutablePath: parsed.CHROMIUM_EXECUTABLE_PATH,
    awsRegion: parsed.AWS_REGION,
    s3Bucket: parsed.S3_BUCKET,
    awsAccessKeyId: parsed.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    exportCacheMaxAgeDays: parsed.EXPORT_CACHE_MAX_AGE_DAYS,
    exportBucketMaxBytes: parsed.EXPORT_BUCKET_MAX_BYTES,
    exportRetentionIntervalMs: parsed.EXPORT_RETENTION_INTERVAL_MS,
  };
}

export const config: AppConfig = build();

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** Public URL path prefix for OAuth (nginx proxies this to the internal /oauth/ routes). */
export const OAUTH_PUBLIC_PATH = "/trip-planner/oauth";

export function isExportStorageConfigured(): boolean {
  return Boolean(config.s3Bucket && config.awsRegion);
}

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    config.googleOAuthClientId &&
      config.googleOAuthClientSecret &&
      config.googleOAuthRedirectUri &&
      config.oauthTokenEncryptionKey &&
      config.publicAppUrl,
  );
}

export function isAviationStackConfigured(): boolean {
  return Boolean(config.aviationStackApiKey?.trim());
}
