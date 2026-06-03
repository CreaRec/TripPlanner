import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "../config";
import { runAgent } from "../agent/runAgent";
import { extractTravelInfoFromImage } from "../agent/vision";
import { ensureUser } from "../services/users";

async function sendAgentResult(
  ctx: {
    reply: (text: string) => Promise<unknown>;
    replyWithDocument: (doc: { source: string }) => Promise<unknown>;
    replyWithPhoto: (photo: { source: string }) => Promise<unknown>;
  },
  result: Awaited<ReturnType<typeof runAgent>>,
): Promise<void> {
  if (result.reply) {
    await ctx.reply(result.reply);
  }
  for (const file of result.files) {
    if (file.toLowerCase().endsWith(".png")) {
      await ctx.replyWithPhoto({ source: file });
    } else {
      await ctx.replyWithDocument({ source: file });
    }
  }
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
    "Save relevant hotel, car rental, reservation, itinerary, place, date, time, address, and confirmation details using the available tools.",
  ];
  if (caption?.trim()) {
    lines.push(`User caption: ${caption.trim()}`);
  }
  lines.push("", "Extracted image details:", extracted);
  return lines.join("\n");
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

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
      ].join("\n"),
    );
  });

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

    await ctx.sendChatAction("typing");
    try {
      const result = await runAgent(ctx.from.id, text);
      await sendAgentResult(ctx, result);
    } catch (err) {
      console.error("[bot] agent error:", err);
      await ctx.reply("Something went wrong while planning. Please try again.");
    }
  });

  return bot;
}
