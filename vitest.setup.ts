// Default env so modules that read config at import time (config.ts, openai client)
// load without a real .env. Individual tests may override via vi.stubEnv / resetModules.
process.env.TELEGRAM_BOT_TOKEN ||= "test-bot-token";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.OPENAI_MODEL ||= "gpt-4o-mini";
process.env.EMBEDDING_MODEL ||= "text-embedding-3-small";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test?schema=public";
process.env.ALLOWED_TELEGRAM_IDS ||= "111";
