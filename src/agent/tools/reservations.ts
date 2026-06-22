import type { Prisma } from "@prisma/client";
import type OpenAI from "openai";
import { getTrip } from "../../services/trip/trips";
import {
  deleteReservation,
  getReservation,
  getReservationForUser,
  isEnrichableReservationType,
  listEnrichableReservationsForUser,
  listReservations,
  RESERVATION_TYPES,
  ReservationType,
} from "../../services/reservations/reservations";
import {
  reEnrichReservation,
  reEnrichReservations,
  saveReservationWithEnrichment,
  summarizeReEnrichResults,
  updateReservationWithEnrichment,
} from "../../services/reservations/reservationEnrichment";
import type { ToolHandler } from "./context";
import { requireConfirmation, requireInteger, requireTrip, RESERVATION_TYPE_VALUES } from "./helpers";

export const reservationsToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_reservation",
      description:
        "Save a confirmed or likely booking/reservation for the active trip. Automatically enriches location details via Google Places when possible; flight reservations are auto-enriched via Aviation Stack (schedule, gates, airports) with Google Places fallback. Returns missing_fields for optional follow-up; do not call search_place_details before saving.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: RESERVATION_TYPE_VALUES,
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
          type: { type: "string", enum: RESERVATION_TYPE_VALUES },
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
      name: "enrich_reservation",
      description:
        "Force re-enrich saved reservation(s). Flights use Aviation Stack with Google Places fallback; hotels, car rentals, campsites, and other location-based reservations use Google Places. Always calls the APIs again. Use when the user asks to re-enrich/reload/update booking details. Pass reservation_id for one booking, all_reservations=true for every enrichable reservation in the active trip, all_flights=true for flights only in the active trip, or all_trips=true for every enrichable reservation across all trips.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: {
            type: "integer",
            description: "Re-enrich one saved reservation by id.",
          },
          all_reservations: {
            type: "boolean",
            description: "Re-enrich all enrichable reservations in the active trip.",
          },
          all_flights: {
            type: "boolean",
            description: "Re-enrich only flight reservations in the active trip.",
          },
          all_trips: {
            type: "boolean",
            description: "Re-enrich all enrichable reservations across every trip owned by the user.",
          },
        },
      },
    },
  },
];

export const reservationsToolHandlers: Record<string, ToolHandler> = {
  async add_reservation(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const metadata =
      args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
        ? (args.metadata as Prisma.InputJsonObject)
        : undefined;
    const result = await saveReservationWithEnrichment({
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
      destination: trip.destination,
    });
    return {
      ok: true,
      enriched: result.enriched,
      missing_fields: result.missingFields,
      reservation_id: result.reservation.id,
      title: result.reservation.title,
      address: result.reservation.address,
    };
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
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const reservationId = requireInteger(args.reservation_id, "reservation_id");
    const existing = await getReservation(tripId, reservationId);
    if (!existing) {
      return { ok: false, reservation_id: null, enriched: false, missing_fields: [] };
    }

    const metadata =
      args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
        ? (args.metadata as Prisma.InputJsonObject)
        : undefined;
    const result = await updateReservationWithEnrichment(
      tripId,
      reservationId,
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
      existing,
      trip.destination,
    );
    return {
      ok: Boolean(result),
      reservation_id: result?.reservation.id,
      enriched: result?.enriched ?? false,
      missing_fields: result?.missingFields ?? [],
    };
  },

  async delete_reservation(ctx, args) {
    requireConfirmation(args);
    const tripId = requireTrip(ctx);
    const ok = await deleteReservation(tripId, requireInteger(args.reservation_id, "reservation_id"));
    return { ok };
  },

  async enrich_reservation(ctx, args) {
    if (args.reservation_id !== undefined) {
      const reservation = await getReservationForUser(
        ctx.telegramId,
        requireInteger(args.reservation_id, "reservation_id"),
      );
      if (!reservation) {
        return { ok: false, error: "Reservation not found.", count: 0, enriched_count: 0, results: [] };
      }
      if (!isEnrichableReservationType(reservation.type)) {
        return {
          ok: false,
          error: `Reservation type "${reservation.type}" does not support enrichment.`,
          count: 0,
          enriched_count: 0,
          results: [],
        };
      }
      const result = await reEnrichReservation(reservation, reservation.trip.destination);
      return { ok: true, ...summarizeReEnrichResults([result]) };
    }

    if (Boolean(args.all_trips)) {
      const reservations = await listEnrichableReservationsForUser(ctx.telegramId);
      const destinationByTripId = new Map(
        reservations.map((reservation) => [reservation.tripId, reservation.trip.destination]),
      );
      const results = await reEnrichReservations(reservations, destinationByTripId);
      return { ok: true, ...summarizeReEnrichResults(results) };
    }

    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");

    const reservations = await listReservations(tripId);
    const destinationByTripId = new Map<number, string | null>([[tripId, trip.destination]]);

    if (Boolean(args.all_reservations)) {
      const results = await reEnrichReservations(reservations, destinationByTripId);
      return { ok: true, ...summarizeReEnrichResults(results) };
    }

    if (Boolean(args.all_flights)) {
      const results = await reEnrichReservations(reservations, destinationByTripId, {
        types: [ReservationType.Flight],
      });
      return { ok: true, ...summarizeReEnrichResults(results) };
    }

    return {
      ok: false,
      error: "Provide reservation_id, all_reservations=true, all_flights=true, or all_trips=true.",
      count: 0,
      enriched_count: 0,
      results: [],
    };
  },
};
