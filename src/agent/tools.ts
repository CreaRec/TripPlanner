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
import {
  deleteSavedPlace,
  listSavedPlaces,
  saveInterestingPlace,
  SAVED_PLACE_STATUSES,
  updateSavedPlace,
} from "../services/savedPlaces";
import type { SavedPlace, SavedPlaceStatus } from "../services/savedPlaces";
import { suggestSavedPlacesOnRoute } from "../services/googleRoutes";
import { generateRouteComparisonMap, isStaticMapsConfigured } from "../services/staticMaps";
import { getWeather, isWeatherConfigured } from "../services/weather";
import { setActiveTripId } from "../services/users";
import { isGmailOAuthConfigured } from "../config";
import { startConnectFlow } from "../http/server";
import {
  disconnectAccount,
  getAccountByEmail,
  getAccountById,
  listAccounts,
} from "../services/gmailAccounts";

const GMAIL_CONNECT_HINT = 'Say "подключить почту" or "connect gmail" in Telegram.';
import { buildGmailSearchQuery } from "../services/gmailSearchQuery";
import { searchGmailAccounts } from "../services/gmailSearch";
import { saveGmailSearchSession } from "../services/gmailSearchSession";
import { buildGmailExportInstruction, exportGmailMessageToPdf } from "../services/gmailExport";
import { getPlace } from "../services/places";

export interface AgentContext {
  telegramId: number;
  activeTripId: number | null;
  /** File paths generated this turn (exports), to be delivered by the bot. */
  exports: string[];
}

type ToolHandler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;

const PLACE_CATEGORY_VALUES = PLACE_CATEGORIES;
const SAVED_PLACE_STATUS_VALUES = SAVED_PLACE_STATUSES;

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

function requireSavedPlaceStatus(value: unknown, name: string): SavedPlaceStatus {
  if (value === null) return "want_to_visit";
  if (
    typeof value !== "string" ||
    !SAVED_PLACE_STATUS_VALUES.includes(value as (typeof SAVED_PLACE_STATUS_VALUES)[number])
  ) {
    throw new Error(`${name} must be one of: ${SAVED_PLACE_STATUS_VALUES.join(", ")}.`);
  }
  return value as SavedPlaceStatus;
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
        "Search Google Places for richer details about a place without saving anything. Works without an active trip; if an active trip exists, its destination is used as search context unless destination is provided. Use when a place name may be ambiguous, then pass the selected external_id to enrich_place when updating an existing trip place.",
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
      name: "save_interesting_place",
      description:
        "Save a place to the user's general interesting places list, not to the active trip. Works even when there is no active trip. Uses Google Places enrichment when possible.",
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
        "Generate an itinerary file and attach it to the chat. Use format 'pdf' or 'csv'. Itinerary exports are cached while plan data is unchanged; pass force_refresh when the user asks to regenerate explicitly.",
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["pdf", "csv"] },
          force_refresh: {
            type: "boolean",
            description: "Regenerate even if a cached export exists.",
          },
        },
        required: ["format"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_gmail_connect",
      description:
        "Start Gmail OAuth and return a one-time link to connect another inbox. Use when the user wants to add, connect, or link a Gmail account or mailbox.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_gmail_accounts",
      description:
        "List Gmail inboxes connected to this user. Use when the user asks which mailboxes are linked.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disconnect_gmail_account",
      description:
        "Disconnect a linked Gmail inbox. Only call after the user explicitly confirms disconnection. Identify the exact google_email or gmail_account_id first.",
      parameters: {
        type: "object",
        properties: {
          gmail_account_id: { type: "integer", description: "Connected Gmail account id." },
          google_email: { type: "string", description: "Connected Gmail address." },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_gmail",
      description:
        "Search connected Gmail accounts for travel-related emails (bookings, confirmations, trip details). Searches all connected inboxes unless gmail_account_id or google_email filters to one. Use when the user asks to find emails for a trip, reservation, or place.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional raw Gmail search query to combine with trip/reservation/place context.",
          },
          trip_id: {
            type: "integer",
            description: "Trip to build search terms from. Defaults to the active trip.",
          },
          reservation_id: {
            type: "integer",
            description: "Reservation/booking to build search terms from.",
          },
          place_id: {
            type: "integer",
            description: "Trip place to build search terms from.",
          },
          gmail_account_id: {
            type: "integer",
            description: "Search only this connected Gmail account.",
          },
          google_email: {
            type: "string",
            description: "Search only this connected Gmail address.",
          },
          max_results: {
            type: "integer",
            description: "Maximum messages to return across all searched accounts (default 10, max 20).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_gmail_message",
      description:
        "Export a Gmail message to a PDF file (renders HTML with inline images) and send separate file attachments from the email. Use when the user asks to read, show, open, or export a specific email found via search_gmail. Requires gmail_account_id and message_id from search results. Cached exports are reused unless force_refresh is true.",
      parameters: {
        type: "object",
        properties: {
          gmail_account_id: {
            type: "integer",
            description: "Connected Gmail account id from search_gmail results.",
          },
          message_id: {
            type: "string",
            description: "Gmail message id from search_gmail results.",
          },
          force_refresh: {
            type: "boolean",
            description: "Re-fetch from Gmail and regenerate even if a cached export exists.",
          },
        },
        required: ["gmail_account_id", "message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Fetch current weather and optional daily forecast for a location. Only use when the user explicitly asks about weather. Defaults to the active trip destination when location is omitted.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City, region, or place name. Defaults to the active trip destination.",
          },
          latitude: { type: "number", description: "Optional latitude if already known." },
          longitude: { type: "number", description: "Optional longitude if already known." },
          forecast_days: {
            type: "integer",
            description: "Number of daily forecast days (0 = current only, max 10). Default 3.",
          },
          units_system: {
            type: "string",
            enum: ["METRIC", "IMPERIAL"],
            description: "Units for temperatures and wind. Default METRIC.",
          },
        },
      },
    },
  },
];

function savedPlaceToToolResult(place: SavedPlace) {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    status: place.status,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    website_url: place.websiteUrl,
    maps_url: place.mapsUrl,
    phone: place.phone,
    booking_url: place.bookingUrl,
    ticket_url: place.ticketUrl,
    reservation_recommended: place.reservationRecommended,
    rating: place.rating,
    price_level: place.priceLevel,
    priority: place.priority,
    duration_min: place.durationMin,
    kid_friendly: place.kidFriendly,
    source_note: place.sourceNote,
    notes: place.notes,
  };
}

function temporarySavedPlaceFromSearchResult(
  telegramId: number,
  place: Awaited<ReturnType<typeof searchPlaceDetails>>[number],
): SavedPlace {
  return {
    id: -1,
    telegramId: BigInt(telegramId),
    name: place.name,
    category: place.category,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    externalProvider: place.provider,
    externalId: place.externalId,
    websiteUrl: null,
    mapsUrl: place.mapsUrl,
    phone: null,
    bookingUrl: null,
    ticketUrl: null,
    reservationRecommended: false,
    openingHours: null,
    rating: null,
    priceLevel: null,
    priority: null,
    durationMin: null,
    kidFriendly: null,
    status: "temporary",
    sourceNote: "Temporary route comparison stop",
    notes: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

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

  async save_interesting_place(ctx, args) {
    const result = await saveInterestingPlace({
      telegramId: ctx.telegramId,
      query: String(args.query),
      externalId: (args.external_id as string) ?? null,
      status:
        args.status !== undefined ? requireSavedPlaceStatus(args.status, "status") : "want_to_visit",
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
      saved_place_id: result.place.id,
      place: savedPlaceToToolResult(result.place),
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
        status: args.status !== undefined ? requireSavedPlaceStatus(args.status, "status") : "want_to_visit",
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
            console.error("[static-maps] route comparison map failed", {
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
    const forceRefresh = Boolean(args.force_refresh);
    const exported =
      format === "csv"
        ? await exportItineraryCsv(trip, { forceRefresh })
        : await exportItineraryPdf(trip, { forceRefresh });
    ctx.exports.push(exported.path);
    return { ok: true, format, file: exported.path, cached: exported.cached };
  },

  async start_gmail_connect(ctx) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const connectUrl = await startConnectFlow(ctx.telegramId);
    return {
      ok: true,
      connect_url: connectUrl,
      instruction:
        "Reply with connect_url on its own line. Explain the user must open it in a browser, sign in with Google, and allow access. The link expires in about 10 minutes. OAuth connects whichever Google account they sign in with (it may differ from an address they typed).",
    };
  },

  async list_gmail_accounts(ctx) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const accounts = await listAccounts(ctx.telegramId);
    return {
      ok: true,
      accounts: accounts.map((a) => ({
        gmail_account_id: a.id,
        google_email: a.googleEmail,
        status: a.status,
        connected_at: a.connectedAt.toISOString(),
      })),
    };
  },

  async disconnect_gmail_account(ctx, args) {
    requireConfirmation(args);

    const hasId = args.gmail_account_id !== undefined;
    const hasEmail = typeof args.google_email === "string" && args.google_email.trim();
    if (!hasId && !hasEmail) {
      throw new Error("Provide gmail_account_id or google_email to disconnect.");
    }
    if (hasId && hasEmail) {
      throw new Error("Provide only one of gmail_account_id or google_email.");
    }

    const identifier = hasId
      ? { id: requireInteger(args.gmail_account_id, "gmail_account_id") }
      : { googleEmail: String(args.google_email).trim() };

    const account =
      identifier.id !== undefined
        ? await getAccountById(ctx.telegramId, identifier.id)
        : await getAccountByEmail(ctx.telegramId, identifier.googleEmail!);

    if (!account) {
      throw new Error("Gmail account not found.");
    }

    const ok = await disconnectAccount(ctx.telegramId, identifier);
    return { ok, google_email: account.googleEmail };
  },

  async search_gmail(ctx, args) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const activeAccounts = await listAccounts(ctx.telegramId, { activeOnly: true });
    if (activeAccounts.length === 0) {
      return {
        ok: false,
        error: "gmail_not_connected",
        connect_hint: GMAIL_CONNECT_HINT,
      };
    }

    let accounts = activeAccounts;
    if (args.gmail_account_id !== undefined) {
      const account = await getAccountById(ctx.telegramId, requireInteger(args.gmail_account_id, "gmail_account_id"));
      if (!account || account.status !== "active") {
        throw new Error(`Gmail account ${args.gmail_account_id} not found or inactive.`);
      }
      accounts = [account];
    } else if (typeof args.google_email === "string" && args.google_email.trim()) {
      const account = await getAccountByEmail(ctx.telegramId, args.google_email.trim());
      if (!account || account.status !== "active") {
        throw new Error(`Gmail account ${args.google_email} not found or inactive.`);
      }
      accounts = [account];
    }

    const tripId =
      args.trip_id !== undefined
        ? requireInteger(args.trip_id, "trip_id")
        : ctx.activeTripId;
    const trip = tripId !== null ? await getTrip(ctx.telegramId, tripId) : null;
    if (args.trip_id !== undefined && !trip) {
      throw new Error(`Trip ${args.trip_id} not found.`);
    }

    let reservation = null;
    if (args.reservation_id !== undefined) {
      const reservationId = requireInteger(args.reservation_id, "reservation_id");
      const tripForReservation = tripId ?? ctx.activeTripId;
      if (tripForReservation === null) {
        throw new Error("No active trip for reservation lookup.");
      }
      const reservations = await listReservations(tripForReservation);
      reservation = reservations.find((r) => r.id === reservationId) ?? null;
      if (!reservation) {
        throw new Error(`Reservation ${reservationId} not found.`);
      }
    }

    let place = null;
    if (args.place_id !== undefined) {
      const placeTripId = tripId ?? ctx.activeTripId;
      if (placeTripId === null) {
        throw new Error("No active trip for place lookup.");
      }
      place = await getPlace(placeTripId, requireInteger(args.place_id, "place_id"));
      if (!place) {
        throw new Error(`Place ${args.place_id} not found.`);
      }
    }

    const queryUsed = buildGmailSearchQuery({
      userQuery: typeof args.query === "string" ? args.query : null,
      trip,
      reservation,
      place,
    });
    if (!queryUsed) {
      throw new Error("Could not build a Gmail search query. Provide query text or trip/reservation/place context.");
    }

    const maxResults = Math.min(
      20,
      Math.max(1, args.max_results !== undefined ? requireInteger(args.max_results, "max_results") : 10),
    );

    const searchResult = await searchGmailAccounts(accounts, {
      q: queryUsed,
      maxResults,
    });
    saveGmailSearchSession(ctx.telegramId, searchResult);

    return {
      ok: true,
      ...searchResult,
      instruction:
        "Summarize the matching messages as a numbered list (subject, sender, date, snippet, account_email). Do not include Gmail links. If the user asks for a message by number from the last search, call export_gmail_message with that message's gmail_account_id and message_id from the cached search context — do not call search_gmail again.",
    };
  },

  async export_gmail_message(ctx, args) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const account = await getAccountById(
      ctx.telegramId,
      requireInteger(args.gmail_account_id, "gmail_account_id"),
    );
    if (!account || account.status !== "active") {
      throw new Error(`Gmail account ${args.gmail_account_id} not found or inactive.`);
    }

    const messageId =
      typeof args.message_id === "string" && args.message_id.trim()
        ? args.message_id.trim()
        : null;
    if (!messageId) {
      throw new Error("message_id is required.");
    }

    const exported = await exportGmailMessageToPdf(account, messageId, {
      forceRefresh: Boolean(args.force_refresh),
    });
    ctx.exports.push(exported.filePath, ...exported.attachmentFiles);

    return {
      ok: true,
      account_email: account.googleEmail,
      subject: exported.subject,
      from: exported.from,
      date: exported.date,
      format: "pdf",
      file: exported.filePath,
      attachment_files: exported.attachmentFiles,
      skipped_attachments: exported.skippedAttachments,
      cached: exported.cached,
      instruction: buildGmailExportInstruction(
        exported.skippedAttachments,
        exported.attachmentFiles.length,
      ),
    };
  },

  async get_weather(ctx, args) {
    if (!isWeatherConfigured()) {
      return {
        ok: false,
        error: "GOOGLE_MAPS_API_KEY is not configured for weather.",
      };
    }

    const trip = ctx.activeTripId === null ? null : await getTrip(ctx.telegramId, ctx.activeTripId);
    const location =
      typeof args.location === "string" && args.location.trim()
        ? args.location.trim()
        : trip?.destination ?? null;
    if (!location && (args.latitude === undefined || args.longitude === undefined)) {
      throw new Error("Provide a location or select an active trip with a destination.");
    }

    const forecastDays =
      args.forecast_days !== undefined ? requireInteger(args.forecast_days, "forecast_days") : 3;
    const unitsSystem = args.units_system === "IMPERIAL" ? "IMPERIAL" : "METRIC";
    const weather = await getWeather({
      location,
      latitude: args.latitude !== undefined ? Number(args.latitude) : null,
      longitude: args.longitude !== undefined ? Number(args.longitude) : null,
      forecastDays,
      unitsSystem,
    });

    return { ok: true, ...weather };
  },
};
