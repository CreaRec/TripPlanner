import type OpenAI from "openai";
import { config } from "../config";
import { openai } from "../openai/client";
import { getTrip } from "../services/trips";
import { getItinerary } from "../services/itinerary";
import { searchMemories } from "../services/memories";
import { recentMessages, saveMessage } from "../services/messages";
import { listReservations } from "../services/reservations";
import { getActiveTripId } from "../services/users";
import { fromDate } from "../util";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AgentContext, toolDefinitions, toolHandlers } from "./tools";
import { extractMemories } from "./memory";

const MAX_TOOL_ITERATIONS = 8;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function fromDateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().replace(/:00\.000Z$/, "Z");
}

async function buildContextBlock(ctx: AgentContext, userText: string): Promise<string> {
  if (ctx.activeTripId === null) {
    return "There is no active trip yet. If the user wants to plan, create one.";
  }
  const trip = await getTrip(ctx.telegramId, ctx.activeTripId);
  if (!trip) return "No active trip found.";

  const [memories, itinerary, reservations] = await Promise.all([
    searchMemories({
      telegramId: ctx.telegramId,
      tripId: ctx.activeTripId,
      queryText: userText,
      limit: 6,
    }),
    getItinerary(ctx.activeTripId),
    listReservations(ctx.activeTripId),
  ]);

  const lines: string[] = [];
  lines.push(`ACTIVE TRIP: ${trip.title}`);
  if (trip.destination) lines.push(`Destination: ${trip.destination}`);
  if (trip.startDate || trip.endDate) {
    lines.push(`Dates: ${fromDate(trip.startDate) ?? "?"} -> ${fromDate(trip.endDate) ?? "?"}`);
  }
  if (trip.travelers) lines.push(`Travelers: ${trip.travelers}`);
  if (trip.summary) lines.push(`Summary: ${trip.summary}`);

  if (memories.length > 0) {
    lines.push("\nRelevant memories:");
    for (const m of memories) lines.push(`- (${m.kind}) ${m.content}`);
  }

  if (itinerary.length > 0) {
    lines.push("\nCurrent itinerary:");
    for (const day of itinerary) {
      lines.push(`Day ${day.dayNumber}${day.title ? ` - ${day.title}` : ""}`);
      for (const item of day.items) {
        const t = item.timeBlock ? `${item.timeBlock}: ` : "";
        lines.push(`  ${item.isBackup ? "[backup] " : ""}${t}${item.title}`);
      }
    }
  }

  if (reservations.length > 0) {
    lines.push("\nCurrent reservations:");
    for (const r of reservations) {
      const dates = [fromDateTime(r.startAt), fromDateTime(r.endAt)].filter(Boolean).join(" -> ");
      const provider = r.provider ? ` via ${r.provider}` : "";
      const confirmation = r.confirmationNumber ? ` (confirmation: ${r.confirmationNumber})` : "";
      const timing = dates ? `${dates}: ` : "";
      lines.push(`- [${r.type}] ${timing}${r.title}${provider}${confirmation}`);
    }
  }

  return lines.join("\n");
}

export interface AgentResult {
  reply: string;
  files: string[];
}

export async function runAgent(telegramId: number, userText: string): Promise<AgentResult> {
  const activeTripId = await getActiveTripId(telegramId);
  const ctx: AgentContext = { telegramId, activeTripId, exports: [] };

  const history = await recentMessages(telegramId, activeTripId, 12);
  const contextBlock = await buildContextBlock(ctx, userText);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Context:\n${contextBlock}` },
    ...history.map(
      (m): ChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }),
    ),
    { role: "user", content: userText },
  ];

  await saveMessage(telegramId, ctx.activeTripId, "user", userText);

  let reply = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    const completion = await openai.chat.completions.create({
      model: config.openaiModel,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });

    const choice = completion.choices[0].message;
    messages.push(choice);

    const toolCalls = choice.tool_calls ?? [];
    if (toolCalls.length === 0) {
      reply = choice.content ?? "";
      break;
    }

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const handler = toolHandlers[call.function.name];
      let result: unknown;
      if (!handler) {
        result = { error: `Unknown tool ${call.function.name}` };
      } else {
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          result = await handler(ctx, args);
        } catch (err) {
          result = { error: (err as Error).message };
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!reply) {
    reply = "Sorry, I got stuck working on that. Could you rephrase or try again?";
  }

  await saveMessage(telegramId, ctx.activeTripId, "assistant", reply);

  // Fire-and-forget structured memory extraction (does not block the reply).
  void extractMemories(telegramId, ctx.activeTripId, userText, reply).catch((err) =>
    console.error("[memory] extraction failed:", err),
  );

  return { reply, files: ctx.exports };
}
