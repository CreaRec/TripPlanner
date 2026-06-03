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
    constructor(public token: string) {}
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
vi.mock("../services/users", () => ({
  ensureUser: f.ensureUser,
  getActiveTripId: f.getActiveTripId,
  setActiveTripId: f.setActiveTripId,
}));
vi.mock("../services/trips", () => ({ listTrips: f.listTrips, getTrip: f.getTrip }));
vi.mock("../services/export", () => ({
  exportItineraryPdf: f.exportItineraryPdf,
  exportItineraryCsv: f.exportItineraryCsv,
}));
vi.mock("../agent/runAgent", () => ({ runAgent: f.runAgent }));
vi.mock("../agent/vision", () => ({ extractTravelInfoFromImage: f.extractTravelInfoFromImage }));

import { createBot } from "./bot";

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
    const h = bot();
    const ctx = fakeCtx({ from: { id: 999 } });
    const next = vi.fn();
    await h.use[0](ctx, next);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not authorized"));
    expect(next).not.toHaveBeenCalled();
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
  it("does not register trip-management slash commands", () => {
    expect(bot().commands).toEqual({});
  });

  it("describes text-based actions in /help", async () => {
    const ctx = fakeCtx();
    await bot().help?.(ctx);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain("plain language");
    expect(text).toContain("Show my trips");
    expect(text).toContain("Leave the current trip");
    expect(text).not.toContain("/trips");
    expect(text).not.toContain("/use");
    expect(text).not.toContain("/export");
  });
});

describe("text handler", () => {
  it("routes free text to the agent and returns the reply plus files", async () => {
    f.runAgent.mockResolvedValueOnce({ reply: "Here is your plan", files: ["/tmp/p.pdf"] });
    const ctx = fakeCtx({ message: { text: "plan my trip" } });
    await handler("text")(ctx);
    expect(f.runAgent).toHaveBeenCalledWith(111, "plan my trip");
    expect(ctx.reply).toHaveBeenCalledWith("Here is your plan");
    expect(ctx.replyWithDocument).toHaveBeenCalledWith({ source: "/tmp/p.pdf" });
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
