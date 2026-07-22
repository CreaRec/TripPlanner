import type { Server } from "node:http";
import { config, isGmailOAuthConfigured } from "./config";
import { createBot } from "./bot/bot";
import { disconnect, pingDatabase } from "./db/prisma";
import { createHttpServer } from "./http/server";
import { scheduleExportRetention } from "./services/export/exportRetention";
import { Logger } from "./telemetry/logger";
import { shutdownTelemetry, startTelemetry } from "./telemetry/otel";

const log = new Logger("startup");
const shutdownLog = new Logger("shutdown");
const fatalLog = new Logger("fatal");

async function main(): Promise<void> {
  await startTelemetry();

  log.info("verifying database connection...");
  await pingDatabase();
  log.info("database reachable.");

  if (config.allowedTelegramIds.length === 0) {
    log.warn(
      "WARNING: ALLOWED_TELEGRAM_IDS is empty - the bot will respond to ANYONE. Set it in .env.",
    );
  }

  let httpServer: Server | null = null;
  if (isGmailOAuthConfigured()) {
    httpServer = createHttpServer();
    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(config.httpPort, () => resolve());
      httpServer!.once("error", reject);
    });
    log.info(`OAuth HTTP server listening on port ${config.httpPort}.`);
  } else {
    log.info("Gmail OAuth not configured — Gmail connect disabled.");
  }

  const bot = createBot();
  const retentionTimer = scheduleExportRetention();

  const shutdown = async (signal: string) => {
    shutdownLog.info(`received ${signal}, stopping...`);
    if (retentionTimer) clearInterval(retentionTimer);
    bot.stop(signal);
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await disconnect();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  log.info("launching Telegram bot...");
  // bot.launch() resolves only when the bot stops, so we don't await it here.
  bot.launch().catch((err) => {
    fatalLog.error("bot stopped with error:", err);
    void shutdownTelemetry().finally(() => process.exit(1));
  });
  log.info("bot is running.");
}

main().catch((err) => {
  fatalLog.error("failed to start:", err);
  void shutdownTelemetry().finally(() => process.exit(1));
});
