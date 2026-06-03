import { config } from "../config";
import { openai } from "../openai/client";

export interface ExtractTravelInfoInput {
  image: Buffer;
  mimeType: string;
  caption?: string | null;
}

export async function extractTravelInfoFromImage(input: ExtractTravelInfoInput): Promise<string> {
  const dataUrl = `data:${input.mimeType};base64,${input.image.toString("base64")}`;
  const caption = input.caption?.trim();

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

  return (completion.choices[0]?.message.content ?? "").trim();
}
