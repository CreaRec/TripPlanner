import type OpenAI from "openai";
import { getTrip } from "../../services/trip/trips";
import { exportItineraryCsv, exportItineraryPdf } from "../../services/export/export";
import { ExportFormat, EXPORT_FORMATS, parseExportFormat } from "../../services/export/exportFormat";
import type { ToolHandler } from "./context";
import { EXPORT_FORMAT_VALUES, requireTrip } from "./helpers";

export const exportToolsToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "export_itinerary",
      description:
        "Generate an itinerary file and attach it to the chat. Use format 'pdf' or 'csv'. Itinerary exports are cached while plan data is unchanged; pass force_refresh when the user asks to regenerate explicitly.",
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: EXPORT_FORMAT_VALUES },
          force_refresh: {
            type: "boolean",
            description: "Regenerate even if a cached export exists.",
          },
        },
        required: ["format"],
      },
    },
  },
];

export const exportToolsToolHandlers: Record<string, ToolHandler> = {
  async export_itinerary(ctx, args) {
    const tripId = requireTrip(ctx);
    const trip = await getTrip(ctx.telegramId, tripId);
    if (!trip) throw new Error("Active trip not found.");
    const format = parseExportFormat(args.format);
    const forceRefresh = Boolean(args.force_refresh);
    const exported =
      format === ExportFormat.Csv
        ? await exportItineraryCsv(trip, { forceRefresh })
        : await exportItineraryPdf(trip, { forceRefresh });
    ctx.exports.push(exported.path);
    return { ok: true, format, file: exported.path, cached: exported.cached };
  },
};
