import { stat } from "node:fs/promises";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config, isGmailOAuthConfigured } from "../config";
import { runAgent } from "../agent/runAgent";
import { extractTravelInfoFromImage } from "../agent/vision";
import { ensureUser } from "../services/platform/users";
import { startConnectFlow } from "../http/server";
import {
  isConnectGmailRequest,
  parseExportGmailByNumberRequest,
} from "../services/gmail/gmailIntents";
import { formatGmailExportSuccessMessage } from "../services/gmail/gmailExport";
import { exportGmailBySearchIndex } from "../services/gmail/gmailSearchSession";
import {
  beginInflight,
  classifyErrorType,
  CONTRACT_SPAN_NAMES,
  endInflight,
  trackCommand,
  trackError,
  trackUpdate,
  withJob,
  type HandlerName,
  type MetricResult,
} from "../telemetry/botMetrics";
import { Logger } from "../telemetry/logger";
import { withSpan } from "../telemetry/otel";

const log = new Logger("bot");

type RequestKind = "text" | "photo" | "document" | "connect_gmail" | "export_gmail";

function handlerForKind(kind: RequestKind): HandlerName {
  switch (kind) {
    case "photo":
    case "document":
      return "vision";
    case "connect_gmail":
      return "gmail_connect";
    case "export_gmail":
      return "gmail_export";
    default:
      return "message";
  }
}

async function sumFileBytes(paths: string[]): Promise<number> {
  let total = 0;
  for (const filePath of paths) {
    try {
      total += (await stat(filePath)).size;
    } catch {
      // Ignore missing files for metrics.
    }
  }
  return total;
}

async function handleBotRequest<T>(
  kind: RequestKind,
  telegramId: number,
  extra: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const handler = handlerForKind(kind);
  beginInflight(handler);
  return withSpan(
    CONTRACT_SPAN_NAMES.handleUpdate,
    {
      "telegram.id": telegramId,
      "request.kind": kind,
      handler,
      "update.kind": "message",
      ...extra,
    },
    async () => {
      log.info("request received", {
        telegram_id: telegramId,
        kind,
        handler,
        ...extra,
      });
      let result: MetricResult = "success";
      let errorType: ReturnType<typeof classifyErrorType> | undefined;
      try {
        const value = await fn();
        log.info("request completed", {
          telegram_id: telegramId,
          kind,
          handler,
          result,
          duration_ms: Date.now() - started,
        });
        return value;
      } catch (err) {
        result = "error";
        errorType = classifyErrorType(err);
        log.error("request failed", {
          telegram_id: telegramId,
          kind,
          handler,
          result,
          error_type: errorType,
          duration_ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        trackUpdate({
          update_kind: "message",
          handler,
          result,
          durationSec: (Date.now() - started) / 1000,
          error_type: errorType,
        });
        endInflight(handler);
      }
    },
  );
}

async function handleCommand(
  command: "/start" | "/help",
  telegramId: number,
  fn: () => Promise<void>,
): Promise<void> {
  const started = Date.now();
  beginInflight("command");
  return withSpan(
    CONTRACT_SPAN_NAMES.command,
    { "bot.command": command, "telegram.id": telegramId, handler: "command" },
    async () => {
      let result: MetricResult = "success";
      let errorType: ReturnType<typeof classifyErrorType> | undefined;
      try {
        await fn();
        trackCommand({ command, result: "success" });
      } catch (err) {
        result = "error";
        errorType = classifyErrorType(err);
        trackCommand({ command, result: "error" });
        throw err;
      } finally {
        trackUpdate({
          update_kind: "command",
          handler: "command",
          result,
          durationSec: (Date.now() - started) / 1000,
          error_type: errorType,
        });
        endInflight("command");
      }
    },
  );
}

async function sendAgentResult(
  ctx: {
    reply: (text: string) => Promise<unknown>;
    replyWithDocument: (doc: { source: string }) => Promise<unknown>;
    replyWithPhoto: (photo: { source: string }) => Promise<unknown>;
  },
  result: Awaited<ReturnType<typeof runAgent>>,
  meta: { telegram_id: number; kind: RequestKind; handler: HandlerName },
): Promise<void> {
  let failedFiles = 0;

  for (const file of result.files) {
    try {
      if (file.toLowerCase().endsWith(".png")) {
        await ctx.replyWithPhoto({ source: file });
      } else {
        await ctx.replyWithDocument({ source: file });
      }
    } catch (err) {
      failedFiles += 1;
      trackError({ error_type: "telegram", handler: meta.handler });
      log.error("failed to send file:", file, err);
    }
  }

  let reply = result.reply;
  if (failedFiles > 0) {
    const suffix =
      failedFiles === result.files.length
        ? "\n\nНе удалось прикрепить файл. Попробуйте ещё раз."
        : "\n\nНе удалось прикрепить часть файлов.";
    reply = reply ? `${reply}${suffix}` : suffix.trim();
  }

  if (reply) {
    await ctx.reply(reply);
  }

  log.info("reply sent", {
    telegram_id: meta.telegram_id,
    kind: meta.kind,
    handler: meta.handler,
    result: failedFiles > 0 ? "error" : "success",
    files: result.files.length,
    failed_files: failedFiles,
    reply_len: reply.length,
  });
}

async function replyDirectGmailExport(
  ctx: {
    from: { id: number };
    reply: (text: string) => Promise<unknown>;
    replyWithDocument: (doc: { source: string }) => Promise<unknown>;
  },
  index: number,
  options?: { forceRefresh?: boolean },
): Promise<boolean> {
  log.info("direct gmail export start", {
    telegram_id: ctx.from.id,
    index,
    force_refresh: Boolean(options?.forceRefresh),
  });

  let outBytes = 0;
  const outcome = await withJob(
    "gmail",
    async () => {
      const result = await exportGmailBySearchIndex(ctx.from.id, index, options);
      if (!result.ok) {
        if (result.reason === "no_session") {
          log.info("direct gmail export skipped", {
            telegram_id: ctx.from.id,
            reason: "no_session",
            result: "skipped",
          });
          return { handled: false, metricResult: "skipped" as const };
        }
        if (result.reason === "invalid_index") {
          await ctx.reply(
            `В последнем поиске только ${result.count} ${result.count === 1 ? "письмо" : "писем"}. Укажите номер от 1 до ${result.count}.`,
          );
          return { handled: true, metricResult: "success" as const };
        }
        if (result.reason === "account_unavailable") {
          await ctx.reply("Gmail-аккаунт для этого письма недоступен. Подключите почту заново.");
          return { handled: true, metricResult: "success" as const };
        }
        trackError({ error_type: "gmail", handler: "gmail_export" });
        log.error("direct gmail export failed:", result.message);
        await ctx.reply("Не удалось экспортировать письмо. Попробуйте ещё раз.");
        return { handled: true, metricResult: "error" as const };
      }

      let failedFiles = 0;
      for (const filePath of result.filePaths) {
        try {
          await ctx.replyWithDocument({ source: filePath });
        } catch (err) {
          failedFiles += 1;
          trackError({ error_type: "telegram", handler: "gmail_export" });
          log.error("failed to send exported gmail file:", filePath, err);
        }
      }

      if (failedFiles === result.filePaths.length) {
        await ctx.reply("Не удалось прикрепить файлы. Попробуйте ещё раз.");
        return { handled: true, metricResult: "error" as const };
      }

      let reply = formatGmailExportSuccessMessage({
        index: result.index,
        attachmentCount: result.attachmentCount,
        skippedAttachments: result.skippedAttachments,
      });
      if (failedFiles > 0) {
        reply = `${reply}\n\nНе удалось прикрепить часть файлов.`;
      }

      await ctx.reply(reply);
      outBytes = await sumFileBytes(result.filePaths);
      log.info("direct gmail export done", {
        telegram_id: ctx.from.id,
        index: result.index,
        files: result.filePaths.length,
        failed_files: failedFiles,
        result: "success",
      });
      return { handled: true, metricResult: "success" as const };
    },
    {
      direction: "out",
      bytes: () => outBytes,
      resultForValue: (value) => value.metricResult,
    },
  );

  return outcome.handled;
}

async function downloadTelegramFile(ctx: {
  telegram: { getFileLink: (fileId: string) => Promise<URL> };
}, fileId: string): Promise<Buffer> {
  const link = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`Telegram file download failed with ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function imagePromptFromExtraction(extracted: string, caption?: string): string {
  const lines = [
    "The user sent an image containing trip information. Use the extracted details below to update the active trip.",
    "Save immediately with add_place, save_interesting_place, or add_reservation — server-side auto-enrichment will run. Do not call search_place_details before saving.",
    "If save tools return missing_fields, mention them once and offer optional follow-up if the user wants to provide more details.",
    "Save relevant hotel, car rental, reservation, itinerary, place, date, time, address, and confirmation details using the available tools.",
  ];
  if (caption?.trim()) {
    lines.push(`User caption: ${caption.trim()}`);
  }
  lines.push("", "Extracted image details:", extracted);
  return lines.join("\n");
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken, {
    handlerTimeout: config.botHandlerTimeoutMs,
  });

  bot.catch((err, ctx) => {
    const errorType = classifyErrorType(err);
    trackError({ error_type: errorType, handler: "message" });
    log.error("unhandled error:", err, {
      telegram_id: ctx.from?.id ?? 0,
      error_type: errorType,
      result: "error",
    });
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "Запрос занял слишком много времени. Попробуйте ещё раз."
        : "Something went wrong. Please try again.";
    void ctx.reply(message).catch((replyErr) => {
      trackError({ error_type: "telegram", handler: "message" });
      log.error("failed to send error reply:", replyErr);
    });
  });

  // Whitelist middleware: only allowed Telegram IDs may use the bot.
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return;
    const allowed = config.allowedTelegramIds;
    if (allowed.length > 0 && !allowed.includes(from.id)) {
      log.warn("unauthorized user", { telegram_id: from.id, result: "skipped" });
      await ctx.reply("Sorry, you are not authorized to use this bot.");
      return;
    }
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username;
    await ensureUser(from.id, name);
    return next();
  });

  bot.start(async (ctx) => {
    await handleCommand("/start", ctx.from.id, async () => {
      await ctx.reply(
        [
          "Hi! I'm your trip planner.",
          "",
          "Just write what you want in plain language: plan a trip, show your trips, switch to another trip, export the itinerary, or leave the current trip.",
          "",
          'Gmail: say "connect gmail" or "подключить почту" to link an inbox, then ask me to find trip or booking emails.',
        ].join("\n"),
      );
    });
  });

  bot.help(async (ctx) => {
    await handleCommand("/help", ctx.from.id, async () => {
      await ctx.reply(
        [
          "Talk to me in plain language to plan a trip.",
          "",
          "Examples:",
          "Show my trips",
          "Switch to the Paris trip",
          "Export the active itinerary as PDF",
          "Leave the current trip",
          "Find emails about my hotel booking",
          "",
          "Gmail examples:",
          'Connect gmail / "подключить почту"',
          "Which inboxes are connected?",
          "Disconnect work@gmail.com",
        ].join("\n"),
      );
    });
  });

  async function replyConnectGmail(ctx: { from: { id: number }; reply: (text: string) => Promise<unknown> }): Promise<void> {
    if (!isGmailOAuthConfigured()) {
      await ctx.reply("Gmail OAuth is not configured on this server yet.");
      return;
    }
    try {
      const url = await startConnectFlow(ctx.from.id);
      log.info("gmail connect link issued", { telegram_id: ctx.from.id, result: "success" });
      await ctx.reply(
        [
          "Open this link to connect Gmail (valid ~10 minutes):",
          url,
          "",
          'Say "connect gmail" or "подключить почту" again to add another inbox.',
        ].join("\n"),
      );
    } catch (err) {
      trackError({ error_type: classifyErrorType(err), handler: "gmail_connect" });
      log.error("connect gmail error:", err);
      await ctx.reply("Could not start Gmail connection. Please try again.");
    }
  }

  bot.on(message("photo"), async (ctx) => {
    const telegramId = ctx.from.id;
    const handler = handlerForKind("photo");
    await handleBotRequest("photo", telegramId, {}, async () => {
      await ctx.sendChatAction("typing");
      try {
        const photo = ctx.message.photo.at(-1);
        if (!photo) {
          await ctx.reply("I couldn't read that photo. Please try sending it again.");
          return;
        }
        const image = await downloadTelegramFile(ctx, photo.file_id);
        log.info("telegram file downloaded", {
          telegram_id: telegramId,
          kind: "photo",
          bytes: image.length,
        });
        const extracted = await extractTravelInfoFromImage({
          image,
          mimeType: "image/jpeg",
          caption: ctx.message.caption,
        });
        if (!extracted || extracted === "NO_TRAVEL_INFO") {
          log.info("image had no travel info", { telegram_id: telegramId, kind: "photo" });
          await ctx.reply("I couldn't find travel details in that image. Try a clearer photo or type the details.");
          return;
        }
        const result = await runAgent(telegramId, imagePromptFromExtraction(extracted, ctx.message.caption));
        await sendAgentResult(ctx, result, { telegram_id: telegramId, kind: "photo", handler });
      } catch (err) {
        trackError({ error_type: classifyErrorType(err), handler });
        log.error("image parsing error:", err);
        await ctx.reply("I couldn't parse that image. Please try a clearer photo or type the details.");
      }
    });
  });

  bot.on(message("document"), async (ctx) => {
    const document = ctx.message.document;
    const mimeType = document.mime_type ?? "";
    if (!mimeType.startsWith("image/")) {
      await ctx.reply("I can parse image files, but not that document type yet. Please send a photo or image file.");
      return;
    }

    const telegramId = ctx.from.id;
    const handler = handlerForKind("document");
    await handleBotRequest("document", telegramId, { mime_type: mimeType }, async () => {
      await ctx.sendChatAction("typing");
      try {
        const image = await downloadTelegramFile(ctx, document.file_id);
        log.info("telegram file downloaded", {
          telegram_id: telegramId,
          kind: "document",
          bytes: image.length,
        });
        const extracted = await extractTravelInfoFromImage({
          image,
          mimeType,
          caption: ctx.message.caption,
        });
        if (!extracted || extracted === "NO_TRAVEL_INFO") {
          log.info("image had no travel info", { telegram_id: telegramId, kind: "document" });
          await ctx.reply("I couldn't find travel details in that image. Try a clearer image or type the details.");
          return;
        }
        const result = await runAgent(telegramId, imagePromptFromExtraction(extracted, ctx.message.caption));
        await sendAgentResult(ctx, result, { telegram_id: telegramId, kind: "document", handler });
      } catch (err) {
        trackError({ error_type: classifyErrorType(err), handler });
        log.error("image parsing error:", err);
        await ctx.reply("I couldn't parse that image. Please try a clearer image or type the details.");
      }
    });
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // unknown command; ignore

    const telegramId = ctx.from.id;
    const exportRequest = parseExportGmailByNumberRequest(text);
    const kind: RequestKind = isConnectGmailRequest(text)
      ? "connect_gmail"
      : exportRequest !== null
        ? "export_gmail"
        : "text";
    const handler = handlerForKind(kind);

    await handleBotRequest(kind, telegramId, { text_len: text.length }, async () => {
      if (kind === "connect_gmail") {
        await replyConnectGmail(ctx);
        return;
      }

      if (exportRequest !== null) {
        await ctx.sendChatAction("upload_document");
        try {
          const handled = await replyDirectGmailExport(ctx, exportRequest.index, {
            forceRefresh: exportRequest.forceRefresh,
          });
          if (handled) return;
        } catch (err) {
          trackError({ error_type: classifyErrorType(err), handler: "gmail_export" });
          log.error("direct gmail export error:", err);
          await ctx.reply("Не удалось экспортировать письмо. Попробуйте ещё раз.");
          return;
        }
      }

      await ctx.sendChatAction("typing");
      const typingTimer = setInterval(() => {
        void ctx.sendChatAction("typing");
      }, 4000);
      try {
        const result = await runAgent(telegramId, text);
        await sendAgentResult(ctx, result, { telegram_id: telegramId, kind: "text", handler });
      } catch (err) {
        trackError({ error_type: classifyErrorType(err), handler });
        log.error("agent error:", err);
        await ctx.reply("Something went wrong while planning. Please try again.");
      } finally {
        clearInterval(typingTimer);
      }
    });
  });

  return bot;
}
