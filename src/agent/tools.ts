import type OpenAI from "openai";
import { createTrip, getTrip, listTrips, updateTrip } from "../services/trips";
import { addPlace, listPlaces } from "../services/places";
import { addItem, clearDay, getItinerary, upsertDay } from "../services/itinerary";
import { saveMemory, searchMemories } from "../services/memories";
import { exportItineraryCsv, exportItineraryPdf } from "../services/export";
import { setActiveTripId } from "../services/users";

export interface AgentContext {
  telegramId: number;
  activeTripId: number | null;
  /** File paths generated this turn (exports), to be delivered by the bot. */
  exports: string[];
}

type ToolHandler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;

function requireTrip(ctx: AgentContext): number {
  if (ctx.activeTripId === null) {
    throw new Error(
      "No active trip. Create one with create_trip first (it becomes the active trip).",
    );
  }
  return ctx.activeTripId;
}

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_trip",
      description:
        "Create a new trip and make it the active trip. Use when the user starts planning a new trip.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short trip title." },
          destination: { type: "string" },
          start_date: { type: "string", description: "ISO date YYYY-MM-DD." },
          end_date: { type: "string", description: "ISO date YYYY-MM-DD." },
          travelers: { type: "string", description: "Free text, e.g. '2 adults, 1 child (7yo)'." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trips",
      description: "List the user's trips with their ids, titles and status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "select_trip",
      description: "Set the active trip by its id (get ids from list_trips).",
      parameters: {
        type: "object",
        properties: { trip_id: { type: "integer" } },
        required: ["trip_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trip",
      description: "Update fields of the active trip, including its high-level summary.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          destination: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          status: { type: "string", description: "e.g. planning, booked, done" },
          travelers: { type: "string" },
          summary: { type: "string", description: "Concise overview of the trip and key constraints." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_place",
      description: "Save a point of interest to the active trip.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          address: { type: "string" },
          priority: { type: "integer", description: "1 = highest priority." },
          duration_min: { type: "integer", description: "Typical visit length in minutes." },
          kid_friendly: { type: "boolean" },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_places",
      description: "List saved places for the active trip.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_day",
      description: "Create or update an itinerary day (title, date, summary) for the active trip.",
      parameters: {
        type: "object",
        properties: {
          day_number: { type: "integer" },
          date: { type: "string", description: "ISO date YYYY-MM-DD." },
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["day_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_itinerary_item",
      description:
        "Append an item to a day's itinerary (the day is created automatically if needed).",
      parameters: {
        type: "object",
        properties: {
          day_number: { type: "integer" },
          title: { type: "string" },
          time_block: { type: "string", description: "e.g. 'morning', '14:00-16:00'." },
          notes: { type: "string" },
          is_backup: { type: "boolean", description: "Mark as a backup/alternative option." },
        },
        required: ["day_number", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_day",
      description: "Remove all items from a day before replanning it.",
      parameters: {
        type: "object",
        properties: { day_number: { type: "integer" } },
        required: ["day_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_itinerary",
      description: "Get the full day-by-day itinerary for the active trip.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Save a durable preference, constraint, decision, or fact so it can be recalled later.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          kind: {
            type: "string",
            description: "preference | constraint | decision | fact | warning",
          },
          global: {
            type: "boolean",
            description: "True if it applies to all trips, not just the active one.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Semantically search saved memories for relevant preferences/constraints/facts.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_itinerary",
      description:
        "Generate an itinerary file and attach it to the chat. Use format 'pdf' or 'csv'.",
      parameters: {
        type: "object",
        properties: { format: { type: "string", enum: ["pdf", "csv"] } },
        required: ["format"],
      },
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async create_trip(ctx, args) {
    const trip = await createTrip({
      telegramId: ctx.telegramId,
      title: String(args.title),
      destination: (args.destination as string) ?? null,
      startDate: (args.start_date as string) ?? null,
      endDate: (args.end_date as string) ?? null,
      travelers: (args.travelers as string) ?? null,
    });
    ctx.activeTripId = trip.id;
    await setActiveTripId(ctx.telegramId, trip.id);
    return { ok: true, trip_id: trip.id, title: trip.title, active: true };
  },

  async list_trips(ctx) {
    const trips = await listTrips(ctx.telegramId);
    return trips.map((t) => ({
      trip_id: t.id,
      title: t.title,
      destination: t.destination,
      status: t.status,
      active: t.id === ctx.activeTripId,
    }));
  },

  async select_trip(ctx, args) {
    const tripId = Number(args.trip_id);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error(`Trip ${tripId} not found.`);
    ctx.activeTripId = trip.id;
    await setActiveTripId(ctx.telegramId, trip.id);
    return { ok: true, trip_id: trip.id, title: trip.title, active: true };
  },

  async update_trip(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await updateTrip(ctx.telegramId, tripId, {
      ...(args.title !== undefined ? { title: String(args.title) } : {}),
      ...(args.destination !== undefined ? { destination: args.destination as string } : {}),
      ...(args.start_date !== undefined ? { startDate: args.start_date as string } : {}),
      ...(args.end_date !== undefined ? { endDate: args.end_date as string } : {}),
      ...(args.status !== undefined ? { status: String(args.status) } : {}),
      ...(args.travelers !== undefined ? { travelers: args.travelers as string } : {}),
      ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
    });
    return { ok: Boolean(trip) };
  },

  async add_place(ctx, args) {
    const tripId = requireTrip(ctx);
    const place = await addPlace({
      tripId,
      name: String(args.name),
      category: (args.category as string) ?? null,
      address: (args.address as string) ?? null,
      priority: (args.priority as number) ?? null,
      durationMin: (args.duration_min as number) ?? null,
      kidFriendly: (args.kid_friendly as boolean) ?? null,
      notes: (args.notes as string) ?? null,
    });
    return { ok: true, place_id: place.id, name: place.name };
  },

  async list_places(ctx) {
    const tripId = requireTrip(ctx);
    const places = await listPlaces(tripId);
    return places.map((p) => ({
      name: p.name,
      category: p.category,
      kid_friendly: p.kidFriendly,
      notes: p.notes,
    }));
  },

  async set_day(ctx, args) {
    const tripId = requireTrip(ctx);
    const day = await upsertDay({
      tripId,
      dayNumber: Number(args.day_number),
      date: (args.date as string) ?? null,
      title: (args.title as string) ?? null,
      summary: (args.summary as string) ?? null,
    });
    return { ok: true, day_number: day.dayNumber };
  },

  async add_itinerary_item(ctx, args) {
    const tripId = requireTrip(ctx);
    const item = await addItem({
      tripId,
      dayNumber: Number(args.day_number),
      title: String(args.title),
      timeBlock: (args.time_block as string) ?? null,
      notes: (args.notes as string) ?? null,
      isBackup: Boolean(args.is_backup),
    });
    return { ok: true, item_id: item.id, day_number: Number(args.day_number) };
  },

  async clear_day(ctx, args) {
    const tripId = requireTrip(ctx);
    await clearDay(tripId, Number(args.day_number));
    return { ok: true };
  },

  async get_itinerary(ctx) {
    const tripId = requireTrip(ctx);
    const itinerary = await getItinerary(tripId);
    return itinerary.map((d) => ({
      day_number: d.dayNumber,
      title: d.title,
      summary: d.summary,
      items: d.items.map((i) => ({
        position: i.position,
        time_block: i.timeBlock,
        title: i.title,
        notes: i.notes,
        is_backup: i.isBackup,
      })),
    }));
  },

  async save_memory(ctx, args) {
    const isGlobal = Boolean(args.global);
    const memory = await saveMemory({
      telegramId: ctx.telegramId,
      tripId: isGlobal ? null : ctx.activeTripId,
      kind: (args.kind as string) ?? "fact",
      content: String(args.content),
    });
    return { ok: true, memory_id: memory.id };
  },

  async search_memory(ctx, args) {
    const memories = await searchMemories({
      telegramId: ctx.telegramId,
      tripId: ctx.activeTripId,
      queryText: String(args.query),
    });
    return memories.map((m) => ({ kind: m.kind, content: m.content }));
  },

  async export_itinerary(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const format = String(args.format) === "csv" ? "csv" : "pdf";
    const path =
      format === "csv" ? await exportItineraryCsv(trip) : await exportItineraryPdf(trip);
    ctx.exports.push(path);
    return { ok: true, format, file: path };
  },
};
