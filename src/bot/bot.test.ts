import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  ensureUser: vi.fn(),
  getActiveTripId: vi.fn(),
  setActiveTripId: vi.fn(),
  listTrips: vi.fn(),
  getTrip: vi.fn(),
  exportItineraryPdf: vi.fn(),
  exportItineraryCsv: vi.fn(),
  runAgent: vi.fn(),
  extractTravelInfoFromImage: vi.fn(),
}));

const { FakeTelegraf } = vi.hoisted(() => {
  class FakeTelegraf {
    handlers: {
      use: Array<(ctx: unknown, next: () => unknown) => unknown>;
      start?: (ctx: unknown) => unknown;
      help?: (ctx: unknown) => unknown;
      commands: Record<string, (ctx: unknown) => unknown>;
      on: Array<{ filter: unknown; fn: (ctx: unknown) => unknown }>;
    } = { use: [], commands: {}, on: [] };
    constructor(public token: string, public options?: unknown) {}
    catch(_fn: unknown) {}
    use(fn: (ctx: unknown, next: () => unknown) => unknown) {
      this.handlers.use.push(fn);
    }
    start(fn: (ctx: unknown) => unknown) {
      this.handlers.start = fn;
    }
    help(fn: (ctx: unknown) => unknown) {
      this.handlers.help = fn;
    }
    command(name: string, fn: (ctx: unknown) => unknown) {
      this.handlers.commands[name] = fn;
    }
    on(filter: unknown, fn: (ctx: unknown) => unknown) {
      this.handlers.on.push({ filter, fn });
    }
    launch() {
      return new Promise(() => {});
    }
    stop() {}
  }
  return { FakeTelegraf };
});

vi.mock("telegraf", () => ({ Telegraf: FakeTelegraf }));
vi.mock("telegraf/filters", () => ({ message: (kind: string) => `${kind}-filter` }));
vi.mock("../services/platform/users", () => ({
  ensureUser: f.ensureUser,
  getActiveTripId: f.getActiveTripId,
  setActiveTripId: f.setActiveTripId,
}));
vi.mock("../services/trip/trips", () => ({ listTrips: f.listTrips, getTrip: f.getTrip }));
vi.mock("../services/export/export", () => ({
  exportItineraryPdf: f.exportItineraryPdf,
  exportItineraryCsv: f.exportItineraryCsv,
}));
vi.mock("../agent/runAgent", () => ({ runAgent: f.runAgent }));
vi.mock("../agent/vision", () => ({ extractTravelInfoFromImage: f.extractTravelInfoFromImage }));
vi.mock("../http/server", () => ({ startConnectFlow: vi.fn().mockResolvedValue("https://example.com/oauth/start") }));
vi.mock("../services/gmail/gmailSearchSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gmail/gmailSearchSession")>();
  return {
    ...actual,
    exportGmailBySearchIndex: vi.fn(),
  };
});
vi.mock("../config", () => ({
  config: { allowedTelegramIds: [111] },
  isGmailOAuthConfigured: vi.fn().mockReturnValue(true),
}));

import { createBot } from "./bot";
import { exportGmailBySearchIndex } from "../services/gmail/gmailSearchSession";
import * as botMetrics from "../telemetry/botMetrics";

interface FakeTelegrafHandlers {
  use: Array<(ctx: unknown, next: () => unknown) => unknown>;
  start?: (ctx: unknown) => unknown;
  help?: (ctx: unknown) => unknown;
  commands: Record<string, (ctx: unknown) => unknown>;
  on: Array<{ filter: unknown; fn: (ctx: unknown) => unknown }>;
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    from: { id: 111, first_name: "Alice" },
    message: { text: "" },
    telegram: { getFileLink: vi.fn().mockResolvedValue(new URL("https://telegram.test/file")) },
    reply: vi.fn(),
    sendChatAction: vi.fn(),
    replyWithDocument: vi.fn(),
    replyWithPhoto: vi.fn(),
    ...overrides,
  };
}

function bot(): FakeTelegrafHandlers {
  return (createBot() as unknown as { handlers: FakeTelegrafHandlers }).handlers;
}

function handler(kind: string) {
  const found = bot().on.find((h) => h.filter === `${kind}-filter`);
  if (!found) throw new Error(`Missing ${kind} handler`);
  return found.fn;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    }),
  );
});

describe("whitelist middleware", () => {
  it("rejects users not in the whitelist", async () => {
    const trackSpy = vi.spyOn(botMetrics, "trackUpdate");
    const h = bot();
    const ctx = fakeCtx({ from: { id: 999 } });
    const next = vi.fn();
    await h.use[0](ctx, next);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not authorized"));
    expect(next).not.toHaveBeenCalled();
    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ result: "skipped", handler: "message" }),
    );
  });

  it("admits whitelisted users and ensures the user row", async () => {
    const h = bot();
    const ctx = fakeCtx({ from: { id: 111, first_name: "Alice" } });
    const next = vi.fn();
    await h.use[0](ctx, next);
    expect(f.ensureUser).toHaveBeenCalledWith(111, "Alice");
    expect(next).toHaveBeenCalled();
  });
});

describe("plain-language help", () => {
  it("does not register gmail slash commands", () => {
    expect(Object.keys(bot().commands)).toEqual([]);
  });

  it("describes text-based actions in /help", async () => {
    const ctx = fakeCtx();
    await bot().help?.(ctx);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain("plain language");
    expect(text).toContain("Show my trips");
    expect(text).toContain("Leave the current trip");
    expect(text).toContain("Connect gmail");
    expect(text).toContain("Which inboxes are connected?");
    expect(text).not.toContain("/connect_gmail");
    expect(text).not.toContain("/trips");
    expect(text).not.toContain("/use");
    expect(text).not.toContain("/export");
  });
});

describe("text handler", () => {
  it("routes free text to the agent and sends files before the reply", async () => {
    f.runAgent.mockResolvedValueOnce({ reply: "Here is your plan", files: ["/tmp/p.pdf"] });
    const ctx = fakeCtx({ message: { text: "plan my trip" } });
    await handler("text")(ctx);
    expect(f.runAgent).toHaveBeenCalledWith(111, "plan my trip");
    expect(ctx.replyWithDocument).toHaveBeenCalledWith({ source: "/tmp/p.pdf" });
    expect(ctx.reply).toHaveBeenCalledWith("Here is your plan");
    expect(ctx.replyWithDocument.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.reply.mock.invocationCallOrder[0],
    );
  });

  it("sends generated PNG files as photos", async () => {
    f.runAgent.mockResolvedValueOnce({ reply: "Map ready", files: ["/tmp/route.png"] });
    const ctx = fakeCtx({ message: { text: "show map" } });
    await handler("text")(ctx);
    expect(ctx.replyWithPhoto).toHaveBeenCalledWith({ source: "/tmp/route.png" });
    expect(ctx.replyWithDocument).not.toHaveBeenCalled();
  });

  it("ignores unknown slash commands", async () => {
    const ctx = fakeCtx({ message: { text: "/unknown" } });
    await handler("text")(ctx);
    expect(f.runAgent).not.toHaveBeenCalled();
  });

  it("records handled agent errors as update errors without throwing", async () => {
    const trackSpy = vi.spyOn(botMetrics, "trackUpdate");
    f.runAgent.mockRejectedValueOnce(new Error("OpenAI rate limit"));
    const ctx = fakeCtx({ message: { text: "plan my trip" } });
    await expect(handler("text")(ctx)).resolves.toBeUndefined();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Something went wrong while planning"),
    );
    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: "message",
        result: "error",
        error_type: "openai",
      }),
    );
  });

  it("starts gmail connect flow for natural-language connect requests", async () => {
    const { startConnectFlow } = await import("../http/server");
    vi.mocked(startConnectFlow).mockResolvedValueOnce(
      "https://example.com/trip-planner/oauth/google/start?state=abc",
    );
    const ctx = fakeCtx({ message: { text: "Подключить почту" } });
    await handler("text")(ctx);
    expect(startConnectFlow).toHaveBeenCalledWith(111);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("trip-planner/oauth/google/start"));
    expect(f.runAgent).not.toHaveBeenCalled();
  });

  it("starts gmail connect flow for add-account phrases and bare Gmail addresses", async () => {
    const { startConnectFlow } = await import("../http/server");
    vi.mocked(startConnectFlow).mockResolvedValue(
      "https://example.com/trip-planner/oauth/google/start?state=abc",
    );

    const addAccountCtx = fakeCtx({ message: { text: "Добавь аккаунт" } });
    await handler("text")(addAccountCtx);
    expect(startConnectFlow).toHaveBeenCalledWith(111);
    expect(addAccountCtx.reply).toHaveBeenCalledWith(expect.stringContaining("trip-planner/oauth/google/start"));
    expect(f.runAgent).not.toHaveBeenCalled();

    f.runAgent.mockClear();
    const emailCtx = fakeCtx({ message: { text: "creativerap@gmail.com" } });
    await handler("text")(emailCtx);
    expect(startConnectFlow).toHaveBeenCalledWith(111);
    expect(emailCtx.reply).toHaveBeenCalledWith(expect.stringContaining("trip-planner/oauth/google/start"));
    expect(f.runAgent).not.toHaveBeenCalled();
  });

  it("exports gmail by number without calling the agent", async () => {
    vi.mocked(exportGmailBySearchIndex).mockResolvedValueOnce({
      ok: true,
      filePaths: ["/tmp/hotel-b-msg2.pdf", "/tmp/hotel-b-ticket.pdf"],
      subject: "Hotel B",
      index: 2,
      attachmentCount: 1,
      skippedAttachments: [{ filename: "large.zip", size: 11_000_000, reason: "too_large" }],
    });
    const ctx = fakeCtx({ message: { text: "Дай письмо 2" } });
    await handler("text")(ctx);
    expect(exportGmailBySearchIndex).toHaveBeenCalledWith(111, 2, { forceRefresh: false });
    expect(ctx.replyWithDocument).toHaveBeenCalledWith({ source: "/tmp/hotel-b-msg2.pdf" });
    expect(ctx.replyWithDocument).toHaveBeenCalledWith({ source: "/tmp/hotel-b-ticket.pdf" });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("PDF"));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("large.zip"));
    expect(f.runAgent).not.toHaveBeenCalled();
  });

  it("falls back to the agent when gmail export has no cached search session", async () => {
    vi.mocked(exportGmailBySearchIndex).mockResolvedValueOnce({ ok: false, reason: "no_session" });
    f.runAgent.mockResolvedValueOnce({ reply: "Повторяю поиск и отправляю PDF.", files: ["/tmp/email.pdf"] });
    const ctx = fakeCtx({ message: { text: "Дай письмо 3" } });
    await handler("text")(ctx);
    expect(exportGmailBySearchIndex).toHaveBeenCalledWith(111, 3, { forceRefresh: false });
    expect(f.runAgent).toHaveBeenCalledWith(111, "Дай письмо 3");
    expect(ctx.replyWithDocument).toHaveBeenCalledWith({ source: "/tmp/email.pdf" });
  });
});

describe("image handlers", () => {
  it("extracts travel info from a photo and routes it to the agent", async () => {
    f.extractTravelInfoFromImage.mockResolvedValueOnce("Hotel ABC, check-in June 10, confirmation H123");
    f.runAgent.mockResolvedValueOnce({ reply: "Saved the hotel details.", files: [] });
    const ctx = fakeCtx({
      message: {
        photo: [{ file_id: "small" }, { file_id: "large" }],
        caption: "add this hotel",
      },
    });

    await handler("photo")(ctx);

    expect(ctx.telegram.getFileLink).toHaveBeenCalledWith("large");
    expect(f.extractTravelInfoFromImage).toHaveBeenCalledWith({
      image: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      caption: "add this hotel",
    });
    expect(f.runAgent).toHaveBeenCalledWith(
      111,
      expect.stringContaining("Hotel ABC, check-in June 10, confirmation H123"),
    );
    expect(f.runAgent.mock.calls[0][1]).toContain("User caption: add this hotel");
    expect(ctx.reply).toHaveBeenCalledWith("Saved the hotel details.");
  });

  it("extracts travel info from an image document", async () => {
    f.extractTravelInfoFromImage.mockResolvedValueOnce("Car rental pickup 9:00 at SFO");
    f.runAgent.mockResolvedValueOnce({ reply: "Saved the car rental.", files: [] });
    const ctx = fakeCtx({
      message: {
        document: { file_id: "doc-1", mime_type: "image/png" },
      },
    });

    await handler("document")(ctx);

    expect(ctx.telegram.getFileLink).toHaveBeenCalledWith("doc-1");
    expect(f.extractTravelInfoFromImage).toHaveBeenCalledWith({
      image: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
      caption: undefined,
    });
    expect(f.runAgent).toHaveBeenCalledWith(111, expect.stringContaining("Car rental pickup 9:00 at SFO"));
    expect(ctx.reply).toHaveBeenCalledWith("Saved the car rental.");
  });

  it("rejects non-image documents", async () => {
    const ctx = fakeCtx({
      message: {
        document: { file_id: "doc-1", mime_type: "application/pdf" },
      },
    });

    await handler("document")(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not that document type"));
    expect(f.extractTravelInfoFromImage).not.toHaveBeenCalled();
  });

  it("reports an unreadable image", async () => {
    f.extractTravelInfoFromImage.mockResolvedValueOnce("NO_TRAVEL_INFO");
    const ctx = fakeCtx({
      message: {
        photo: [{ file_id: "p1" }],
      },
    });

    await handler("photo")(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("couldn't find travel details"));
    expect(f.runAgent).not.toHaveBeenCalled();
  });
});
