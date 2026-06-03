import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ quiet: true });

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
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATA_DIR: z.string().default("./data/exports"),
});

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramIds: number[];
  openaiApiKey: string;
  openaiModel: string;
  openaiVisionModel: string;
  embeddingModel: string;
  googleMapsApiKey?: string;
  databaseUrl: string;
  dataDir: string;
}

function build(): AppConfig {
  const parsed = schema.parse(process.env);
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedTelegramIds: parseIds(parsed.ALLOWED_TELEGRAM_IDS),
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiModel: parsed.OPENAI_MODEL,
    openaiVisionModel: parsed.OPENAI_VISION_MODEL ?? parsed.OPENAI_MODEL,
    embeddingModel: parsed.EMBEDDING_MODEL,
    googleMapsApiKey: parsed.GOOGLE_MAPS_API_KEY,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: parsed.DATA_DIR,
  };
}

export const config: AppConfig = build();
