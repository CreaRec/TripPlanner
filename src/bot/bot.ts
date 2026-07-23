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

async function sendAgentResult(
  ctx: {
    reply: (text: string) => Promise<unknown>;
    replyWithDocument: (doc: { source: string }) => Promise<unknown>;
    replyWithPhoto: (photo: { source: string }) => Promise<unknown>;
  },
  result: Awaited<ReturnType<typeof runAgent>>,
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
      console.error("[bot] failed to send file:", file, err);
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
  const result = await exportGmailBySearchIndex(ctx.from.id, index, options);
  if (!result.ok) {
    if (result.reason === "no_session") {
      return false;
    }
    if (result.reason === "invalid_index") {
      await ctx.reply(
        `В последнем поиске только ${result.count} ${result.count === 1 ? "письмо" : "писем"}. Укажите номер от 1 до ${result.count}.`,
      );
      return true;
    }
    if (result.reason === "account_unavailable") {
      await ctx.reply("Gmail-аккаунт для этого письма недоступен. Подключите почту заново.");
      return true;
    }
    console.error("[bot] direct gmail export failed:", result.message);
    await ctx.reply("Не удалось экспортировать письмо. Попробуйте ещё раз.");
    return true;
  }

  let failedFiles = 0;
  for (const filePath of result.filePaths) {
    try {
      await ctx.replyWithDocument({ source: filePath });
    } catch (err) {
      failedFiles += 1;
      console.error("[bot] failed to send exported gmail file:", filePath, err);
    }
  }

  if (failedFiles === result.filePaths.length) {
    await ctx.reply("Не удалось прикрепить файлы. Попробуйте ещё раз.");
    return true;
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
  return true;
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
    console.error("[bot] unhandled error:", err);
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "Запрос занял слишком много времени. Попробуйте ещё раз."
        : "Something went wrong. Please try again.";
    void ctx.reply(message).catch((replyErr) => {
      console.error("[bot] failed to send error reply:", replyErr);
    });
  });

  // Whitelist middleware: only allowed Telegram IDs may use the bot.
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return;
    const allowed = config.allowedTelegramIds;
    if (allowed.length > 0 && !allowed.includes(from.id)) {
      await ctx.reply("Sorry, you are not authorized to use this bot.");
      return;
    }
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username;
    await ensureUser(from.id, name);
    return next();
  });

  bot.start(async (ctx) => {
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

  bot.help(async (ctx) => {
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

  async function replyConnectGmail(ctx: { from: { id: number }; reply: (text: string) => Promise<unknown> }): Promise<void> {
    if (!isGmailOAuthConfigured()) {
      await ctx.reply("Gmail OAuth is not configured on this server yet.");
      return;
    }
    try {
      const url = await startConnectFlow(ctx.from.id);
      await ctx.reply(
        [
          "Open this link to connect Gmail (valid ~10 minutes):",
          url,
          "",
          'Say "connect gmail" or "подключить почту" again to add another inbox.',
        ].join("\n"),
      );
    } catch (err) {
      console.error("[bot] connect gmail error:", err);
      await ctx.reply("Could not start Gmail connection. Please try again.");
    }
  }

  bot.on(message("photo"), async (ctx) => {
    await ctx.sendChatAction("typing");
    try {
      const photo = ctx.message.photo.at(-1);
      if (!photo) {
        await ctx.reply("I couldn't read that photo. Please try sending it again.");
        return;
      }
      const image = await downloadTelegramFile(ctx, photo.file_id);
      const extracted = await extractTravelInfoFromImage({
        image,
        mimeType: "image/jpeg",
        caption: ctx.message.caption,
      });
      if (!extracted || extracted === "NO_TRAVEL_INFO") {
        await ctx.reply("I couldn't find travel details in that image. Try a clearer photo or type the details.");
        return;
      }
      const result = await runAgent(ctx.from.id, imagePromptFromExtraction(extracted, ctx.message.caption));
      await sendAgentResult(ctx, result);
    } catch (err) {
      console.error("[bot] image parsing error:", err);
      await ctx.reply("I couldn't parse that image. Please try a clearer photo or type the details.");
    }
  });

  bot.on(message("document"), async (ctx) => {
    const document = ctx.message.document;
    const mimeType = document.mime_type ?? "";
    if (!mimeType.startsWith("image/")) {
      await ctx.reply("I can parse image files, but not that document type yet. Please send a photo or image file.");
      return;
    }

    await ctx.sendChatAction("typing");
    try {
      const image = await downloadTelegramFile(ctx, document.file_id);
      const extracted = await extractTravelInfoFromImage({
        image,
        mimeType,
        caption: ctx.message.caption,
      });
      if (!extracted || extracted === "NO_TRAVEL_INFO") {
        await ctx.reply("I couldn't find travel details in that image. Try a clearer image or type the details.");
        return;
      }
      const result = await runAgent(ctx.from.id, imagePromptFromExtraction(extracted, ctx.message.caption));
      await sendAgentResult(ctx, result);
    } catch (err) {
      console.error("[bot] image parsing error:", err);
      await ctx.reply("I couldn't parse that image. Please try a clearer image or type the details.");
    }
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // unknown command; ignore

    if (isConnectGmailRequest(text)) {
      await replyConnectGmail(ctx);
      return;
    }

    const exportRequest = parseExportGmailByNumberRequest(text);
    if (exportRequest !== null) {
      await ctx.sendChatAction("upload_document");
      try {
        const handled = await replyDirectGmailExport(ctx, exportRequest.index, {
          forceRefresh: exportRequest.forceRefresh,
        });
        if (handled) return;
      } catch (err) {
        console.error("[bot] direct gmail export error:", err);
        await ctx.reply("Не удалось экспортировать письмо. Попробуйте ещё раз.");
        return;
      }
    }

    await ctx.sendChatAction("typing");
    const typingTimer = setInterval(() => {
      void ctx.sendChatAction("typing");
    }, 4000);
    try {
      const result = await runAgent(ctx.from.id, text);
      await sendAgentResult(ctx, result);
    } catch (err) {
      console.error("[bot] agent error:", err);
      await ctx.reply("Something went wrong while planning. Please try again.");
    } finally {
      clearInterval(typingTimer);
    }
  });

  return bot;
}
