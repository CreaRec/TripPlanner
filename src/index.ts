import type { Server } from "node:http";
import { config, isGmailOAuthConfigured } from "./config";
import { createBot } from "./bot/bot";
import { disconnect, pingDatabase } from "./db/prisma";
import { createHttpServer } from "./http/server";
import { logger } from "./log";
import { scheduleExportRetention } from "./services/export/exportRetention";
import { shutdownTelemetry, startTelemetry } from "./telemetry";

async function main(): Promise<void> {
  const tel = startTelemetry();
  logger.info("[startup] telemetry ready", {
    component: "startup",
    service_name: tel.serviceName,
    service_namespace: tel.serviceNamespace,
  });

  logger.info("[startup] verifying database connection...", { component: "startup", step: "db_ping" });
  await pingDatabase();
  logger.info("[startup] database reachable", { component: "startup", step: "db_ok" });

  if (config.allowedTelegramIds.length === 0) {
    logger.warn(
      "[startup] ALLOWED_TELEGRAM_IDS is empty - the bot will respond to ANYONE. Set it in .env.",
      { component: "startup" },
    );
  }

  let httpServer: Server | null = null;
  if (isGmailOAuthConfigured()) {
    httpServer = createHttpServer();
    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(config.httpPort, () => resolve());
      httpServer!.once("error", reject);
    });
    logger.info("[startup] OAuth HTTP server listening", {
      component: "startup",
      step: "http_listen",
      port: config.httpPort,
    });
  } else {
    logger.info("[startup] Gmail OAuth not configured — Gmail connect disabled", {
      component: "startup",
    });
  }

  const bot = createBot();
  const retentionTimer = scheduleExportRetention();

  const shutdown = async (signal: string) => {
    logger.info("[shutdown] received signal, stopping...", { component: "shutdown", signal });
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

  logger.info("[startup] launching Telegram bot...", { component: "startup", step: "bot_launch" });
  // bot.launch() resolves only when the bot stops, so we don't await it here.
  bot.launch().catch(async (err) => {
    logger.exception("[fatal] bot stopped with error", err, { component: "startup" });
    await shutdownTelemetry();
    process.exit(1);
  });
  logger.info("[startup] bot is running", { component: "startup", step: "bot_running" });
}

main().catch(async (err) => {
  logger.exception("[fatal] failed to start", err, { component: "startup" });
  await shutdownTelemetry();
  process.exit(1);
});
