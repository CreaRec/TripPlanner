import type OpenAI from "openai";
import { createTrip, deleteTrip, getTrip, listTrips, updateTrip } from "../../services/trip/trips";
import {
  addItem,
  clearDay,
  deleteDay,
  deleteItem,
  getItinerary,
  updateItem,
  upsertDay,
} from "../../services/trip/itinerary";
import { deleteMemory, listMemories, replaceMemory, saveMemory, searchMemories } from "../../services/trip/memories";
import { formatTripSummary } from "../../services/trip/tripSummaryFormat";
import type { TripSummaryFormat, TripSummaryLocale } from "../../services/trip/tripSummaryFormat";
import { listReservations } from "../../services/reservations/reservations";
import { setActiveTripId } from "../../services/platform/users";
import type { ToolHandler } from "./context";
import { requireConfirmation, requireInteger, requireTrip } from "./helpers";

export const tripToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
      name: "clear_active_trip",
      description:
        "Clear the active trip without deleting it. Use when the user wants to leave/exit the current trip or have no active trip selected.",
      parameters: { type: "object", properties: {} },
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
      name: "delete_trip",
      description:
        "Delete a trip and its related places, itinerary, and reservations. Only call after the user explicitly confirms deletion.",
      parameters: {
        type: "object",
        properties: {
          trip_id: { type: "integer", description: "Trip id. Defaults to the active trip if omitted." },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["confirmed"],
      },
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
      name: "update_itinerary_item",
      description: "Update an existing itinerary item in the active trip.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "integer" },
          day_number: { type: "integer", description: "Move the item to this day if provided." },
          position: { type: "integer" },
          title: { type: "string" },
          time_block: { type: "string", description: "e.g. 'morning', '14:00-16:00'." },
          notes: { type: "string" },
          place_id: { type: "integer" },
          is_backup: { type: "boolean" },
        },
        required: ["item_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_itinerary_item",
      description: "Delete an itinerary item from the active trip. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["item_id", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_day",
      description:
        "Remove all items from a day before replanning it. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          day_number: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["day_number", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_day",
      description:
        "Delete an itinerary day and all of its items from the active trip. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          day_number: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["day_number", "confirmed"],
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
      name: "get_trip_summary",
      description:
        "Return a formatted trip overview for the active trip. Use format 'card' for a compact overview with icon sections (dates, transport, hotel, plan, notes), or 'by_day' for a day-by-day view. Call this when the user asks for a trip summary, overview, status, or what is planned.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["card", "by_day"],
            description: "card = compact overview with icon blocks; by_day = day-by-day breakdown.",
          },
          locale: {
            type: "string",
            enum: ["en", "ru"],
            description: "Language for section labels and dates. Match the user's language.",
          },
        },
        required: ["format"],
      },
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
      name: "replace_memory",
      description:
        "Replace a saved memory with corrected text. This deletes the old memory and saves a new embedded memory.",
      parameters: {
        type: "object",
        properties: {
          memory_id: { type: "integer" },
          content: { type: "string" },
          kind: {
            type: "string",
            description: "preference | constraint | decision | fact | warning",
          },
          global: {
            type: "boolean",
            description: "True if the new memory applies to all trips, not just the active one.",
          },
        },
        required: ["memory_id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description: "Delete a saved memory. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          memory_id: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["memory_id", "confirmed"],
      },
    },
  },
];

export const tripToolHandlers: Record<string, ToolHandler> = {
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

  async clear_active_trip(ctx) {
    ctx.activeTripId = null;
    await setActiveTripId(ctx.telegramId, null);
    return { ok: true, active: false };
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

  async delete_trip(ctx, args) {
    requireConfirmation(args);
    const tripId = args.trip_id !== undefined ? requireInteger(args.trip_id, "trip_id") : requireTrip(ctx);
    const ok = await deleteTrip(ctx.telegramId, tripId);
    if (ok && ctx.activeTripId === tripId) {
      ctx.activeTripId = null;
      await setActiveTripId(ctx.telegramId, null);
    }
    return { ok };
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

  async update_itinerary_item(ctx, args) {
    const tripId = requireTrip(ctx);
    const item = await updateItem(tripId, requireInteger(args.item_id, "item_id"), {
      ...(args.day_number !== undefined ? { dayNumber: requireInteger(args.day_number, "day_number") } : {}),
      ...(args.position !== undefined ? { position: requireInteger(args.position, "position") } : {}),
      ...(args.title !== undefined ? { title: String(args.title) } : {}),
      ...(args.time_block !== undefined ? { timeBlock: args.time_block as string } : {}),
      ...(args.notes !== undefined ? { notes: args.notes as string } : {}),
      ...(args.place_id !== undefined ? { placeId: requireInteger(args.place_id, "place_id") } : {}),
      ...(args.is_backup !== undefined ? { isBackup: Boolean(args.is_backup) } : {}),
    });
    return { ok: Boolean(item), item_id: item?.id };
  },

  async delete_itinerary_item(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    const ok = await deleteItem(tripId, requireInteger(args.item_id, "item_id"));
    return { ok };
  },

  async clear_day(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    await clearDay(tripId, Number(args.day_number));
    return { ok: true };
  },

  async delete_day(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    const ok = await deleteDay(tripId, requireInteger(args.day_number, "day_number"));
    return { ok };
  },

  async get_itinerary(ctx) {
    const tripId = requireTrip(ctx);
    const itinerary = await getItinerary(tripId);
    return itinerary.map((d) => ({
      id: d.id,
      day_number: d.dayNumber,
      title: d.title,
      summary: d.summary,
      items: d.items.map((i) => ({
        id: i.id,
        position: i.position,
        time_block: i.timeBlock,
        title: i.title,
        notes: i.notes,
        is_backup: i.isBackup,
      })),
    }));
  },

  async get_trip_summary(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const format = String(args.format) === "by_day" ? "by_day" : "card";
    const locale: TripSummaryLocale = args.locale === "ru" ? "ru" : "en";
    const [itinerary, reservations, memories] = await Promise.all([
      getItinerary(tripId),
      listReservations(tripId),
      listMemories(ctx.telegramId, tripId),
    ]);
    const text = formatTripSummary({
      trip,
      itinerary,
      reservations,
      memories: memories.slice(0, 5),
      format: format as TripSummaryFormat,
      locale,
    });
    return {
      format,
      locale,
      text,
      instruction:
        "Reply with the text field exactly as returned. Do not rephrase, add a duplicate heading, or convert it into a different layout.",
    };
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
    return memories.map((m) => ({ id: m.id, trip_id: m.trip_id, kind: m.kind, content: m.content }));
  },

  async replace_memory(ctx, args) {
    const isGlobal = Boolean(args.global);
    const memory = await replaceMemory({
      telegramId: ctx.telegramId,
      memoryId: requireInteger(args.memory_id, "memory_id"),
      tripId: isGlobal ? null : ctx.activeTripId,
      kind: (args.kind as string) ?? "fact",
      content: String(args.content),
    });
    return { ok: Boolean(memory), memory_id: memory?.id };
  },

  async delete_memory(ctx, args) {
    requireConfirmation(args);
    const ok = await deleteMemory(ctx.telegramId, requireInteger(args.memory_id, "memory_id"), ctx.activeTripId);
    return { ok };
  },
};
