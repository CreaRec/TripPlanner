import type { Prisma } from "@prisma/client";
import type OpenAI from "openai";
import { createTrip, deleteTrip, getTrip, listTrips, updateTrip } from "../services/trips";
import {
  PLACE_CATEGORIES,
  addPlace,
  deletePlace,
  listPlaces,
  updatePlace,
} from "../services/places";
import type { PlaceCategory } from "../services/places";
import {
  addItem,
  clearDay,
  deleteDay,
  deleteItem,
  getItinerary,
  updateItem,
  upsertDay,
} from "../services/itinerary";
import { deleteMemory, replaceMemory, saveMemory, searchMemories } from "../services/memories";
import {
  addReservation,
  deleteReservation,
  listReservations,
  updateReservation,
} from "../services/reservations";
import { exportItineraryCsv, exportItineraryPdf } from "../services/export";
import {
  enrichPlace,
  searchPlaceDetails,
} from "../services/placeEnrichment";
import { setActiveTripId } from "../services/users";

export interface AgentContext {
  telegramId: number;
  activeTripId: number | null;
  /** File paths generated this turn (exports), to be delivered by the bot. */
  exports: string[];
}

type ToolHandler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;

const PLACE_CATEGORY_VALUES = PLACE_CATEGORIES;

function requireTrip(ctx: AgentContext): number {
  if (ctx.activeTripId === null) {
    throw new Error(
      "No active trip. Create one with create_trip first (it becomes the active trip).",
    );
  }
  return ctx.activeTripId;
}

function requireConfirmation(args: Record<string, unknown>): void {
  if (args.confirmed !== true) {
    throw new Error("Explicit user confirmation is required before deleting data.");
  }
}

function requireInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`${name} must be an integer.`);
  }
  return number;
}

function requirePlaceCategory(value: unknown, name: string): PlaceCategory {
  if (value === null) return "other";
  if (
    typeof value !== "string" ||
    !PLACE_CATEGORY_VALUES.includes(value as (typeof PLACE_CATEGORY_VALUES)[number])
  ) {
    throw new Error(`${name} must be one of: ${PLACE_CATEGORY_VALUES.join(", ")}.`);
  }
  return value as PlaceCategory;
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
      name: "add_reservation",
      description:
        "Save a confirmed or likely booking/reservation for the active trip, such as a hotel, car rental, flight, campsite, or other reservation.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["hotel", "car_rental", "flight", "campsite", "other"],
          },
          title: { type: "string", description: "Short human-readable reservation title." },
          provider: { type: "string", description: "Company, hotel, airline, rental agency, or booking provider." },
          confirmation_number: { type: "string" },
          start_at: { type: "string", description: "ISO date/time when this reservation starts." },
          end_at: { type: "string", description: "ISO date/time when this reservation ends." },
          address: { type: "string" },
          status: { type: "string", description: "e.g. booked, pending, cancelled." },
          notes: { type: "string" },
          metadata: {
            type: "object",
            description: "Additional structured details that do not fit the common fields.",
          },
        },
        required: ["type", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reservations",
      description: "List saved reservations/bookings for the active trip.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_reservation",
      description: "Update an existing reservation/booking for the active trip.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: { type: "integer" },
          type: { type: "string", enum: ["hotel", "car_rental", "flight", "campsite", "other"] },
          title: { type: "string" },
          provider: { type: "string" },
          confirmation_number: { type: "string" },
          start_at: { type: "string", description: "ISO date/time when this reservation starts." },
          end_at: { type: "string", description: "ISO date/time when this reservation ends." },
          address: { type: "string" },
          status: { type: "string", description: "e.g. booked, pending, cancelled." },
          notes: { type: "string" },
          metadata: {
            type: "object",
            description: "Additional structured details that do not fit the common fields.",
          },
        },
        required: ["reservation_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_reservation",
      description: "Delete an existing reservation/booking. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["reservation_id", "confirmed"],
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
      name: "delete_trip",
      description:
        "Delete a trip and its related places, itinerary, reservations, and plan versions. Only call after the user explicitly confirms deletion.",
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
      name: "add_place",
      description: "Save a point of interest to the active trip.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: PLACE_CATEGORY_VALUES },
          address: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          website_url: { type: "string" },
          maps_url: { type: "string" },
          phone: { type: "string" },
          booking_url: { type: "string" },
          ticket_url: { type: "string" },
          reservation_recommended: { type: "boolean" },
          rating: { type: "number" },
          price_level: { type: "integer" },
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
      name: "search_place_details",
      description:
        "Search Google Places for richer details about a place without saving anything. Use when a place name may be ambiguous, then pass the selected external_id to enrich_place when updating an existing saved place.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Place name or search query." },
          max_results: { type: "integer", description: "Maximum number of candidates to return." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enrich_place",
      description:
        "Enrich an existing saved place with Google Places details: address, coordinates, links, hours/rating, and booking or ticket advice. If search_place_details returned one clear match for this saved place, call enrich_place with the existing place_id and that result's external_id.",
      parameters: {
        type: "object",
        properties: {
          place_id: { type: "integer" },
          query: { type: "string", description: "Optional search query if the saved name is too vague." },
          external_id: { type: "string", description: "Google Places id from search_place_details." },
        },
        required: ["place_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_place",
      description: "Update a saved place for the active trip.",
      parameters: {
        type: "object",
        properties: {
          place_id: { type: "integer" },
          name: { type: "string" },
          category: { type: "string", enum: PLACE_CATEGORY_VALUES },
          address: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          website_url: { type: "string" },
          maps_url: { type: "string" },
          phone: { type: "string" },
          booking_url: { type: "string" },
          ticket_url: { type: "string" },
          reservation_recommended: { type: "boolean" },
          rating: { type: "number" },
          price_level: { type: "integer" },
          priority: { type: "integer", description: "1 = highest priority." },
          duration_min: { type: "integer", description: "Typical visit length in minutes." },
          kid_friendly: { type: "boolean" },
          notes: { type: "string" },
        },
        required: ["place_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_place",
      description: "Delete a saved place from the active trip. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          place_id: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["place_id", "confirmed"],
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

  async add_place(ctx, args) {
    const tripId = requireTrip(ctx);
    const place = await addPlace({
      tripId,
      name: String(args.name),
      category:
        args.category !== undefined ? requirePlaceCategory(args.category, "category") : null,
      address: (args.address as string) ?? null,
      latitude: (args.latitude as number) ?? null,
      longitude: (args.longitude as number) ?? null,
      websiteUrl: (args.website_url as string) ?? null,
      mapsUrl: (args.maps_url as string) ?? null,
      phone: (args.phone as string) ?? null,
      bookingUrl: (args.booking_url as string) ?? null,
      ticketUrl: (args.ticket_url as string) ?? null,
      reservationRecommended: (args.reservation_recommended as boolean) ?? null,
      rating: (args.rating as number) ?? null,
      priceLevel: (args.price_level as number) ?? null,
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
      id: p.id,
      name: p.name,
      category: p.category,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      website_url: p.websiteUrl,
      maps_url: p.mapsUrl,
      phone: p.phone,
      booking_url: p.bookingUrl,
      ticket_url: p.ticketUrl,
      reservation_recommended: p.reservationRecommended,
      rating: p.rating,
      price_level: p.priceLevel,
      priority: p.priority,
      duration_min: p.durationMin,
      kid_friendly: p.kidFriendly,
      notes: p.notes,
    }));
  },

  async search_place_details(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const places = await searchPlaceDetails({
      query: String(args.query),
      destination: trip.destination,
      maxResults: args.max_results !== undefined ? requireInteger(args.max_results, "max_results") : undefined,
    });
    return places.map((p) => ({
      external_provider: p.provider,
      external_id: p.externalId,
      name: p.name,
      category: p.category,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      maps_url: p.mapsUrl,
      types: p.types,
    }));
  },

  async enrich_place(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const result = await enrichPlace({
      tripId,
      placeId: requireInteger(args.place_id, "place_id"),
      destination: trip.destination,
      query: (args.query as string) ?? null,
      externalId: (args.external_id as string) ?? null,
    });
    return {
      ok: result.updated,
      place_id: result.place?.id ?? null,
      duplicate_place_id: result.duplicatePlaceId,
      google_place: result.googlePlace
        ? {
            external_id: result.googlePlace.externalId,
            name: result.googlePlace.name,
            category: result.googlePlace.category,
            address: result.googlePlace.address,
            website_url: result.googlePlace.websiteUrl,
            maps_url: result.googlePlace.mapsUrl,
            phone: result.googlePlace.phone,
            booking_url: result.googlePlace.bookingUrl,
            ticket_url: result.googlePlace.ticketUrl,
            reservation_recommended: result.googlePlace.reservationRecommended,
            advice: result.googlePlace.advice,
          }
        : null,
    };
  },

  async update_place(ctx, args) {
    const tripId = requireTrip(ctx);
    const place = await updatePlace(tripId, requireInteger(args.place_id, "place_id"), {
      ...(args.name !== undefined ? { name: String(args.name) } : {}),
      ...(args.category !== undefined
        ? { category: requirePlaceCategory(args.category, "category") }
        : {}),
      ...(args.address !== undefined ? { address: args.address as string } : {}),
      ...(args.latitude !== undefined ? { latitude: Number(args.latitude) } : {}),
      ...(args.longitude !== undefined ? { longitude: Number(args.longitude) } : {}),
      ...(args.website_url !== undefined ? { websiteUrl: args.website_url as string } : {}),
      ...(args.maps_url !== undefined ? { mapsUrl: args.maps_url as string } : {}),
      ...(args.phone !== undefined ? { phone: args.phone as string } : {}),
      ...(args.booking_url !== undefined ? { bookingUrl: args.booking_url as string } : {}),
      ...(args.ticket_url !== undefined ? { ticketUrl: args.ticket_url as string } : {}),
      ...(args.reservation_recommended !== undefined
        ? { reservationRecommended: Boolean(args.reservation_recommended) }
        : {}),
      ...(args.rating !== undefined ? { rating: Number(args.rating) } : {}),
      ...(args.price_level !== undefined ? { priceLevel: requireInteger(args.price_level, "price_level") } : {}),
      ...(args.priority !== undefined ? { priority: requireInteger(args.priority, "priority") } : {}),
      ...(args.duration_min !== undefined
        ? { durationMin: requireInteger(args.duration_min, "duration_min") }
        : {}),
      ...(args.kid_friendly !== undefined ? { kidFriendly: Boolean(args.kid_friendly) } : {}),
      ...(args.notes !== undefined ? { notes: args.notes as string } : {}),
    });
    return { ok: Boolean(place), place_id: place?.id };
  },

  async delete_place(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    const ok = await deletePlace(tripId, requireInteger(args.place_id, "place_id"));
    return { ok };
  },

  async add_reservation(ctx, args) {
    const tripId = requireTrip(ctx);
    const metadata =
      args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
        ? (args.metadata as Prisma.InputJsonObject)
        : undefined;
    const reservation = await addReservation({
      tripId,
      type: String(args.type),
      title: String(args.title),
      provider: (args.provider as string) ?? null,
      confirmationNumber: (args.confirmation_number as string) ?? null,
      startAt: (args.start_at as string) ?? null,
      endAt: (args.end_at as string) ?? null,
      address: (args.address as string) ?? null,
      status: (args.status as string) ?? null,
      notes: (args.notes as string) ?? null,
      metadata,
    });
    return { ok: true, reservation_id: reservation.id, title: reservation.title };
  },

  async list_reservations(ctx) {
    const tripId = requireTrip(ctx);
    const reservations = await listReservations(tripId);
    return reservations.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      provider: r.provider,
      confirmation_number: r.confirmationNumber,
      start_at: r.startAt?.toISOString() ?? null,
      end_at: r.endAt?.toISOString() ?? null,
      address: r.address,
      status: r.status,
      notes: r.notes,
    }));
  },

  async update_reservation(ctx, args) {
    const tripId = requireTrip(ctx);
    const metadata =
      args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
        ? (args.metadata as Prisma.InputJsonObject)
        : undefined;
    const reservation = await updateReservation(
      tripId,
      requireInteger(args.reservation_id, "reservation_id"),
      {
        ...(args.type !== undefined ? { type: String(args.type) } : {}),
        ...(args.title !== undefined ? { title: String(args.title) } : {}),
        ...(args.provider !== undefined ? { provider: args.provider as string } : {}),
        ...(args.confirmation_number !== undefined
          ? { confirmationNumber: args.confirmation_number as string }
          : {}),
        ...(args.start_at !== undefined ? { startAt: args.start_at as string } : {}),
        ...(args.end_at !== undefined ? { endAt: args.end_at as string } : {}),
        ...(args.address !== undefined ? { address: args.address as string } : {}),
        ...(args.status !== undefined ? { status: args.status as string } : {}),
        ...(args.notes !== undefined ? { notes: args.notes as string } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
    );
    return { ok: Boolean(reservation), reservation_id: reservation?.id };
  },

  async delete_reservation(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    const ok = await deleteReservation(tripId, requireInteger(args.reservation_id, "reservation_id"));
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
