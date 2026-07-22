import { getTrip } from "../../services/trip/trips";
import {
  PLACE_CATEGORIES,
  deletePlace,
  listPlaces,
  updatePlace,
} from "../../services/places/places";
import {
  enrichPlace,
  saveTripPlace,
  saveTripPlaceFromSaved,
  searchPlaceDetails,
} from "../../services/places/placeEnrichment";
import {
  deleteSavedPlace,
  enrichSavedPlace,
  listSavedPlaces,
  saveInterestingPlace,
  SAVED_PLACE_STATUSES,
  SavedPlaceStatus,
  updateSavedPlace,
} from "../../services/places/savedPlaces";
import type { SavedPlace } from "../../services/places/savedPlaces";
import { suggestSavedPlacesOnRoute } from "../../services/providers/googleRoutes";
import { generateRouteComparisonMap, isStaticMapsConfigured } from "../../services/providers/staticMaps";
import { Logger } from "../../telemetry/logger";
import type OpenAI from "openai";
import type { ToolHandler } from "./context";
import {
  PLACE_CATEGORY_VALUES,
  requireConfirmation,
  requireInteger,
  requirePlaceCategory,
  requireSavedPlaceStatus,
  requireTrip,
  SAVED_PLACE_STATUS_VALUES,
} from "./helpers";
import {
  googlePlaceToToolResult,
  savedPlaceToToolResult,
  temporarySavedPlaceFromSearchResult,
} from "./serializers";

const staticMapsLog = new Logger("static-maps");

export const placesToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_place",
      description:
        "Save a point of interest to the active trip. Automatically enriches with Google Places when possible. Returns missing_fields for optional follow-up. Do not call search_place_details before saving. Use saved_place_id to copy an existing general interesting place into the trip.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Place name or Google Places search query." },
          saved_place_id: {
            type: "integer",
            description: "Optional id from general interesting places to copy into the trip without re-searching.",
          },
          external_id: { type: "string", description: "Google Places id if already known." },
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
        "Search Google Places without saving. Do NOT use before add_place or save_interesting_place. Use only when the user wants to browse candidates without saving, or to research before deciding.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Place name or search query." },
          destination: { type: "string", description: "Optional city/region/country to bias the search." },
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
        "Enrich an existing trip place with Google Places details. Do NOT use before add_place. Use for already saved places missing address/maps_url, or when the user explicitly asks for details.",
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
      name: "enrich_interesting_place",
      description:
        "Enrich an existing general interesting place with Google Places details. Do NOT use before save_interesting_place. Use for already saved places missing address/maps_url, or when the user explicitly asks for details.",
      parameters: {
        type: "object",
        properties: {
          saved_place_id: { type: "integer" },
          query: { type: "string", description: "Optional search query if the saved name is too vague." },
          external_id: { type: "string", description: "Google Places id from search_place_details." },
        },
        required: ["saved_place_id"],
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
      name: "save_interesting_place",
      description:
        "Save a place to the user's general interesting places list, not to the active trip. Automatically enriches with Google Places when possible. Returns missing_fields for optional follow-up. Do not call search_place_details before saving.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Place name or Google Places search query." },
          external_id: { type: "string", description: "Google Places id if already known." },
          status: { type: "string", enum: SAVED_PLACE_STATUS_VALUES },
          source_note: { type: "string", description: "Why the user wants to remember this place." },
          notes: { type: "string" },
          priority: { type: "integer", description: "1 = highest priority." },
          duration_min: { type: "integer", description: "Typical visit length in minutes." },
          kid_friendly: { type: "boolean" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_interesting_places",
      description:
        "List the user's general interesting places, independent of the active trip.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: SAVED_PLACE_STATUS_VALUES },
          category: { type: "string", enum: PLACE_CATEGORY_VALUES },
          with_coordinates_only: { type: "boolean" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_interesting_place",
      description: "Update a place in the user's general interesting places list.",
      parameters: {
        type: "object",
        properties: {
          saved_place_id: { type: "integer" },
          name: { type: "string" },
          category: { type: "string", enum: PLACE_CATEGORY_VALUES },
          address: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          status: { type: "string", enum: SAVED_PLACE_STATUS_VALUES },
          priority: { type: "integer", description: "1 = highest priority." },
          duration_min: { type: "integer", description: "Typical visit length in minutes." },
          kid_friendly: { type: "boolean" },
          source_note: { type: "string" },
          notes: { type: "string" },
        },
        required: ["saved_place_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_interesting_place",
      description:
        "Delete a place from the user's general interesting places list. Only call after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          saved_place_id: { type: "integer" },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["saved_place_id", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_saved_places_on_route",
      description:
        "Find the user's saved interesting places near a driving route and suggest those with a small detour. Use only when both origin and destination are known; if the user only gives a destination like 'Utah', ask where they are starting from before calling this tool.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Route start address/place/city. Do not guess this." },
          destination: { type: "string", description: "Route end address/place/city. Do not guess this." },
          stop_query: {
            type: "string",
            description:
              "Specific stop/place to compare as a detour, e.g. 'Dallas' or 'Space Center Houston'. Use this when the user explicitly says they want to go via a specific place.",
          },
          status: { type: "string", enum: SAVED_PLACE_STATUS_VALUES },
          category: { type: "string", enum: PLACE_CATEGORY_VALUES },
          max_distance_from_route_km: {
            type: "number",
            description: "Polyline prefilter radius in km. Default is 50.",
          },
          max_route_checks: {
            type: "integer",
            description: "Maximum detour route checks to run after polyline filtering. Default is 15.",
          },
          max_detour_min: {
            type: "integer",
            description: "Maximum extra driving time in minutes. Default is 30.",
          },
          max_detour_ratio: {
            type: "number",
            description: "Maximum extra driving time as a fraction of base route duration. Default is 0.15.",
          },
          include_maps: {
            type: "boolean",
            description:
              "If true, generate Google Static Maps PNG comparisons for top suggestions and attach them to the chat.",
          },
          max_maps: {
            type: "integer",
            description: "Maximum number of comparison maps to attach. Default is 3, hard limit is 3.",
          },
        },
        required: ["origin", "destination"],
      },
    },
  },
];

export const placesToolHandlers: Record<string, ToolHandler> = {
  async add_place(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");

    const result =
      args.saved_place_id !== undefined
        ? await saveTripPlaceFromSaved({
            tripId,
            telegramId: ctx.telegramId,
            savedPlaceId: requireInteger(args.saved_place_id, "saved_place_id"),
            priority: args.priority !== undefined ? requireInteger(args.priority, "priority") : null,
            durationMin:
              args.duration_min !== undefined ? requireInteger(args.duration_min, "duration_min") : null,
            kidFriendly: args.kid_friendly !== undefined ? Boolean(args.kid_friendly) : null,
            notes: (args.notes as string) ?? null,
          })
        : await saveTripPlace({
            tripId,
            query: String(args.name),
            destination: trip.destination,
            externalId: (args.external_id as string) ?? null,
            category:
              args.category !== undefined ? requirePlaceCategory(args.category, "category") : null,
            address: (args.address as string) ?? null,
            latitude: (args.latitude as number) ?? null,
            longitude: (args.longitude as number) ?? null,
            priority: (args.priority as number) ?? null,
            durationMin: (args.duration_min as number) ?? null,
            kidFriendly: (args.kid_friendly as boolean) ?? null,
            notes: (args.notes as string) ?? null,
          });

    return {
      ok: true,
      created: result.created,
      enriched: result.enriched,
      missing_fields: result.missingFields,
      place_id: result.place.id,
      name: result.place.name,
      duplicate_place_id: result.duplicatePlaceId,
      google_place: result.googlePlace ? googlePlaceToToolResult(result.googlePlace) : null,
    };
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
    const trip = ctx.activeTripId === null ? null : await getTrip(ctx.telegramId, ctx.activeTripId);
    const places = await searchPlaceDetails({
      query: String(args.query),
      destination: (args.destination as string) ?? trip?.destination ?? null,
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
      enriched: result.enriched,
      missing_fields: result.missingFields,
      place_id: result.place?.id ?? null,
      duplicate_place_id: result.duplicatePlaceId,
      google_place: result.googlePlace ? googlePlaceToToolResult(result.googlePlace) : null,
    };
  },

  async enrich_interesting_place(ctx, args) {
    const result = await enrichSavedPlace({
      telegramId: ctx.telegramId,
      savedPlaceId: requireInteger(args.saved_place_id, "saved_place_id"),
      query: (args.query as string) ?? null,
      externalId: (args.external_id as string) ?? null,
    });
    return {
      ok: result.updated,
      enriched: result.enriched,
      missing_fields: result.missingFields,
      saved_place_id: result.place?.id ?? null,
      duplicate_saved_place_id: result.duplicateSavedPlaceId,
      place: result.place ? savedPlaceToToolResult(result.place) : null,
      google_place: result.googlePlace ? googlePlaceToToolResult(result.googlePlace) : null,
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

  async save_interesting_place(ctx, args) {
    const trip =
      ctx.activeTripId === null ? null : await getTrip(ctx.telegramId, ctx.activeTripId);
    const result = await saveInterestingPlace({
      telegramId: ctx.telegramId,
      query: String(args.query),
      destination: trip?.destination ?? null,
      externalId: (args.external_id as string) ?? null,
      status:
        args.status !== undefined ? requireSavedPlaceStatus(args.status, "status") : SavedPlaceStatus.WantToVisit,
      sourceNote: (args.source_note as string) ?? null,
      notes: (args.notes as string) ?? null,
      priority: args.priority !== undefined ? requireInteger(args.priority, "priority") : null,
      durationMin:
        args.duration_min !== undefined ? requireInteger(args.duration_min, "duration_min") : null,
      kidFriendly: args.kid_friendly !== undefined ? Boolean(args.kid_friendly) : null,
    });
    return {
      ok: true,
      created: result.created,
      enriched: result.enriched,
      missing_fields: result.missingFields,
      saved_place_id: result.place.id,
      place: savedPlaceToToolResult(result.place),
      google_place: result.googlePlace ? googlePlaceToToolResult(result.googlePlace) : null,
    };
  },

  async list_interesting_places(ctx, args) {
    const places = await listSavedPlaces(ctx.telegramId, {
      status: args.status !== undefined ? requireSavedPlaceStatus(args.status, "status") : undefined,
      category:
        args.category !== undefined ? requirePlaceCategory(args.category, "category") : undefined,
      withCoordinatesOnly: Boolean(args.with_coordinates_only),
      limit: args.limit !== undefined ? requireInteger(args.limit, "limit") : undefined,
    });
    return places.map(savedPlaceToToolResult);
  },

  async update_interesting_place(ctx, args) {
    const place = await updateSavedPlace(ctx.telegramId, requireInteger(args.saved_place_id, "saved_place_id"), {
      ...(args.name !== undefined ? { name: String(args.name) } : {}),
      ...(args.category !== undefined
        ? { category: requirePlaceCategory(args.category, "category") }
        : {}),
      ...(args.address !== undefined ? { address: args.address as string } : {}),
      ...(args.latitude !== undefined ? { latitude: Number(args.latitude) } : {}),
      ...(args.longitude !== undefined ? { longitude: Number(args.longitude) } : {}),
      ...(args.status !== undefined ? { status: requireSavedPlaceStatus(args.status, "status") } : {}),
      ...(args.priority !== undefined ? { priority: requireInteger(args.priority, "priority") } : {}),
      ...(args.duration_min !== undefined
        ? { durationMin: requireInteger(args.duration_min, "duration_min") }
        : {}),
      ...(args.kid_friendly !== undefined ? { kidFriendly: Boolean(args.kid_friendly) } : {}),
      ...(args.source_note !== undefined ? { sourceNote: args.source_note as string } : {}),
      ...(args.notes !== undefined ? { notes: args.notes as string } : {}),
    });
    return { ok: Boolean(place), saved_place_id: place?.id, place: place ? savedPlaceToToolResult(place) : null };
  },

  async delete_interesting_place(ctx, args) {
    requireConfirmation(args);
    const ok = await deleteSavedPlace(ctx.telegramId, requireInteger(args.saved_place_id, "saved_place_id"));
    return { ok };
  },

  async suggest_saved_places_on_route(ctx, args) {
    const stopQuery = typeof args.stop_query === "string" && args.stop_query.trim() ? args.stop_query.trim() : null;
    let places: SavedPlace[];
    if (stopQuery) {
      let candidates = await searchPlaceDetails({
        query: stopQuery,
        destination: null,
        maxResults: 1,
      });
      if (candidates.length === 0) {
        candidates = await searchPlaceDetails({
          query: stopQuery,
          destination: String(args.destination),
          maxResults: 1,
        });
      }
      const stop = candidates.find((p) => p.latitude !== null && p.longitude !== null);
      places = stop ? [temporarySavedPlaceFromSearchResult(ctx.telegramId, stop)] : [];
    } else {
      places = await listSavedPlaces(ctx.telegramId, {
        status: args.status !== undefined ? requireSavedPlaceStatus(args.status, "status") : SavedPlaceStatus.WantToVisit,
        category:
          args.category !== undefined ? requirePlaceCategory(args.category, "category") : undefined,
        withCoordinatesOnly: true,
      });
    }
    const suggestions = await suggestSavedPlacesOnRoute(
      String(args.origin),
      String(args.destination),
      places,
      {
        maxDistanceFromRouteMeters:
          stopQuery ? Number.POSITIVE_INFINITY : args.max_distance_from_route_km !== undefined
            ? Number(args.max_distance_from_route_km) * 1000
            : undefined,
        maxRouteChecks:
          args.max_route_checks !== undefined
            ? requireInteger(args.max_route_checks, "max_route_checks")
            : undefined,
        maxDetourDurationSeconds:
          args.max_detour_min !== undefined ? requireInteger(args.max_detour_min, "max_detour_min") * 60 : undefined,
        maxDetourRatio: args.max_detour_ratio !== undefined ? Number(args.max_detour_ratio) : undefined,
        includeRejectedSuggestions: Boolean(args.include_maps) || Boolean(stopQuery),
      },
    );
    const includeMaps = Boolean(args.include_maps);
    const maxMaps =
      args.max_maps !== undefined
        ? Math.min(3, Math.max(0, requireInteger(args.max_maps, "max_maps")))
        : 3;
    const mapFiles = new Map<number, string>();
    const mapErrors = new Map<number, string>();
    if (includeMaps && maxMaps > 0) {
      const mapCandidates = suggestions.slice(0, maxMaps);
      if (!isStaticMapsConfigured()) {
        for (const suggestion of mapCandidates) {
          mapErrors.set(suggestion.place.id, "GOOGLE_MAPS_API_KEY is not configured for Static Maps.");
        }
      } else {
        for (const suggestion of mapCandidates) {
          if (!suggestion.detourEncodedPolyline) continue;
          try {
            const file = await generateRouteComparisonMap({
              origin: suggestion.origin,
              destination: suggestion.destination,
              stopName: suggestion.place.name,
              startLocation: suggestion.startLocation,
              stopLocation: suggestion.stopLocation,
              endLocation: suggestion.endLocation,
              baseEncodedPolyline: suggestion.baseEncodedPolyline,
              detourEncodedPolyline: suggestion.detourEncodedPolyline,
              detourDurationSeconds: suggestion.detourDurationSeconds,
              detourDistanceMeters: suggestion.detourDistanceMeters,
            });
            ctx.exports.push(file);
            mapFiles.set(suggestion.place.id, file);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            staticMapsLog.error("route comparison map failed", {
              placeId: suggestion.place.id,
              error: message,
            });
            mapErrors.set(suggestion.place.id, message);
          }
        }
      }
    }
    const mappedSuggestions = suggestions.map((s) => ({
      place: savedPlaceToToolResult(s.place),
      distance_from_route_km: Math.round((s.distanceFromRouteMeters / 1000) * 10) / 10,
      detour_min: Math.round(s.detourDurationSeconds / 60),
      detour_km: Math.round((s.detourDistanceMeters / 1000) * 10) / 10,
      detour_ratio: Math.round(s.detourRatio * 1000) / 1000,
      within_detour_threshold: s.withinDetourThreshold,
      route_duration_min: Math.round(s.routeDurationSeconds / 60),
      route_distance_km: Math.round((s.routeDistanceMeters / 1000) * 10) / 10,
      comparison_map_requested: includeMaps,
      comparison_map_generated: mapFiles.has(s.place.id),
      comparison_map_file: mapFiles.get(s.place.id) ?? null,
      comparison_map_error: mapErrors.get(s.place.id) ?? null,
    }));
    return {
      suggestions: mappedSuggestions,
      maps_requested: includeMaps,
      maps_generated_count: mapFiles.size,
      attached_files: [...mapFiles.values()],
      instruction:
        mapFiles.size > 0
          ? "You may say the comparison map is attached."
          : "Do not say a comparison map is attached. If the user asked for a map, explain that no map image was generated and use comparison_map_error if present.",
    };
  },
};
