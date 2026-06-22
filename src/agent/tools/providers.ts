import type OpenAI from "openai";
import { getTrip } from "../../services/trip/trips";
import { getWeather, isWeatherConfigured } from "../../services/providers/weather";
import type { ToolHandler } from "./context";
import { requireInteger } from "./helpers";

export const providersToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

export const providersToolHandlers: Record<string, ToolHandler> = {
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
