import { config } from "../config";
import { openai } from "../openai/client";
import { saveMemory } from "../services/memories";

const EXTRACTION_PROMPT = `You extract durable, reusable travel memories from a single user/assistant exchange.

Return ONLY facts worth remembering long-term: stable preferences, hard constraints, and explicit decisions. Ignore small talk, transient questions, and anything already obvious.

Respond with a JSON object: {"memories": [{"kind": "preference|constraint|decision|fact|warning", "content": "..."}]}.
If there is nothing worth saving, return {"memories": []}. Keep each content short and self-contained.`;

interface ExtractedMemory {
  kind: string;
  content: string;
}

export async function extractMemories(
  telegramId: number,
  tripId: number | null,
  userText: string,
  assistantText: string,
): Promise<void> {
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: `USER: ${userText}\n\nASSISTANT: ${assistantText}` },
    ],
  });

  const raw = completion.choices[0].message.content;
  if (!raw) return;

  let parsed: { memories?: ExtractedMemory[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
  for (const m of memories) {
    if (!m || typeof m.content !== "string" || m.content.trim().length === 0) continue;
    await saveMemory({
      telegramId,
      tripId,
      kind: typeof m.kind === "string" ? m.kind : "fact",
      content: m.content.trim(),
    });
  }
}
