import { config } from "./config";
import { createBot } from "./bot/bot";
import { disconnect, pingDatabase } from "./db/prisma";

async function main(): Promise<void> {
  console.log("[startup] verifying database connection...");
  await pingDatabase();
  console.log("[startup] database reachable.");

  if (config.allowedTelegramIds.length === 0) {
    console.warn(
      "[startup] WARNING: ALLOWED_TELEGRAM_IDS is empty - the bot will respond to ANYONE. Set it in .env.",
    );
  }

  const bot = createBot();

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, stopping...`);
    bot.stop(signal);
    await disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("[startup] launching Telegram bot...");
  // bot.launch() resolves only when the bot stops, so we don't await it here.
  bot.launch().catch((err) => {
    console.error("[fatal] bot stopped with error:", err);
    process.exit(1);
  });
  console.log("[startup] bot is running.");
}

main().catch((err) => {
  console.error("[fatal] failed to start:", err);
  process.exit(1);
});
