import { config } from "../config";
import { openai } from "../openai/client";
import { withJob } from "../telemetry/botMetrics";
import { Logger } from "../telemetry/logger";

const log = new Logger("vision");

export interface ExtractTravelInfoInput {
  image: Buffer;
  mimeType: string;
  caption?: string | null;
}

export async function extractTravelInfoFromImage(input: ExtractTravelInfoInput): Promise<string> {
  return withJob(
    "vision",
    async () => {
      const started = Date.now();
      log.info("extract start", {
        mime_type: input.mimeType,
        image_bytes: input.image.length,
        has_caption: Boolean(input.caption?.trim()),
      });

      const dataUrl = `data:${input.mimeType};base64,${input.image.toString("base64")}`;
      const caption = input.caption?.trim();

      try {
        const completion = await openai.chat.completions.create({
          model: config.openaiVisionModel,
          messages: [
            {
              role: "system",
              content: [
                "Extract travel-planning details from images for a Telegram trip planner.",
                "Focus on hotels, car rentals, flights, reservations, addresses, dates, times, confirmation numbers, costs, and important policies.",
                "Return concise plain text with only visible or strongly implied facts. If no travel information is visible, say: NO_TRAVEL_INFO.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    "Read this image and extract any trip information that should be saved or added to an itinerary.",
                    caption ? `User caption: ${caption}` : "No user caption was provided.",
                  ].join("\n"),
                },
                {
                  type: "image_url",
                  image_url: { url: dataUrl },
                },
              ],
            },
          ],
        });

        const extracted = (completion.choices[0]?.message.content ?? "").trim();
        log.info("extract done", {
          mime_type: input.mimeType,
          has_travel_info: Boolean(extracted) && extracted !== "NO_TRAVEL_INFO",
          extracted_len: extracted.length,
          duration_ms: Date.now() - started,
          result: "success",
        });
        return extracted;
      } catch (err) {
        log.error("extract failed", {
          mime_type: input.mimeType,
          duration_ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
          result: "error",
        });
        throw err;
      }
    },
    {
      direction: "in",
      bytes: () => input.image.length,
    },
  );
}
