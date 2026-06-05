import type { Server } from "node:http";
import { config, isGmailOAuthConfigured } from "./config";
import { createBot } from "./bot/bot";
import { disconnect, pingDatabase } from "./db/prisma";
import { createHttpServer } from "./http/server";

async function main(): Promise<void> {
  console.log("[startup] verifying database connection...");
  await pingDatabase();
  console.log("[startup] database reachable.");

  if (config.allowedTelegramIds.length === 0) {
    console.warn(
      "[startup] WARNING: ALLOWED_TELEGRAM_IDS is empty - the bot will respond to ANYONE. Set it in .env.",
    );
  }

  let httpServer: Server | null = null;
  if (isGmailOAuthConfigured()) {
    httpServer = createHttpServer();
    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(config.httpPort, () => resolve());
      httpServer!.once("error", reject);
    });
    console.log(`[startup] OAuth HTTP server listening on port ${config.httpPort}.`);
  } else {
    console.log("[startup] Gmail OAuth not configured — Gmail connect disabled.");
  }

  const bot = createBot();

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, stopping...`);
    bot.stop(signal);
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
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
