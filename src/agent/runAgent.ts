import type OpenAI from "openai";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { config } from "../config";
import { openai } from "../openai/client";
import { getTrip } from "../services/trip/trips";
import { getItinerary } from "../services/trip/itinerary";
import { searchMemories } from "../services/trip/memories";
import {
  clearPendingDestructiveAction,
  getPendingDestructiveAction,
  type PendingDestructiveAction,
  recentMessages,
  saveMessage,
  savePendingDestructiveAction,
} from "../services/platform/messages";
import { listReservations } from "../services/reservations/reservations";
import { listSavedPlaces, SavedPlaceStatus } from "../services/places/savedPlaces";
import { getActiveTripId } from "../services/platform/users";
import { formatGmailContextLine, listAccounts } from "../services/gmail/gmailAccounts";
import {
  formatGmailSearchSessionContext,
  getGmailSearchSession,
} from "../services/gmail/gmailSearchSession";
import { withJobSpan } from "../telemetry/botMetrics";
import { Logger } from "../telemetry/logger";
import { getTracer } from "../telemetry/otel";
import { fromDate } from "../util";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { AgentContext, toolDefinitions, toolHandlers } from "./tools";
import { extractMemories } from "./memory";

const MAX_TOOL_ITERATIONS = 8;

const agentLog = new Logger("agent");
const memoryLog = new Logger("memory");

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const DESTRUCTIVE_TOOL_NAMES = new Set([
  "delete_trip",
  "delete_place",
  "delete_reservation",
  "delete_itinerary_item",
  "clear_day",
  "delete_day",
  "delete_memory",
  "delete_interesting_place",
  "disconnect_gmail_account",
]);

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => JSON.parse(sortedJson(item))));
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = JSON.parse(sortedJson((value as Record<string, unknown>)[key]));
    }
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
}

function destructiveArgsForComparison(args: Record<string, unknown>): Record<string, unknown> {
  const { confirmed: _confirmed, ...rest } = args;
  return rest;
}

function sameDestructiveAction(
  pending: PendingDestructiveAction,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  return (
    pending.toolName === toolName &&
    sortedJson(pending.args) === sortedJson(destructiveArgsForComparison(args))
  );
}

function isDestructiveConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(yes|y|ok|okay|confirm|confirmed|delete it|do it|да|ок|ага|подтверждаю|удаляй|удали|можно|давай)([.!?\s]*)$/i.test(
    normalized,
  );
}

function isDestructiveCancellation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(no|n|cancel|stop|don't|do not|нет|не надо|отмена|отмени|стоп|оставь|не удаляй)([.!?\s]*)$/i.test(
    normalized,
  );
}

function confirmationRequiredResult(toolName: string, args: Record<string, unknown>) {
  return {
    confirmation_required: true,
    deletion_performed: false,
    pending_action: {
      tool_name: toolName,
      args: destructiveArgsForComparison(args),
    },
    instruction:
      "Do not say the deletion was completed. Ask the user to explicitly confirm this exact deletion in a separate reply.",
  };
}

function fromDateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().replace(/:00\.000Z$/, "Z");
}

async function savedPlacesContextLines(telegramId: number): Promise<string[]> {
  const savedPlaces = await listSavedPlaces(telegramId, { status: SavedPlaceStatus.WantToVisit, limit: 8 });
  if (savedPlaces.length === 0) return [];
  return [
    "\nGeneral interesting places:",
    ...savedPlaces.map((p) => {
      const location = [p.address, p.latitude !== null && p.longitude !== null ? `${p.latitude},${p.longitude}` : null]
        .filter(Boolean)
        .join(" | ");
      return `- [${p.id}] ${p.name}${p.category ? ` (${p.category})` : ""}${location ? ` - ${location}` : ""}`;
    }),
  ];
}

async function gmailContextLine(telegramId: number): Promise<string> {
  const accounts = await listAccounts(telegramId);
  const lines = [formatGmailContextLine(accounts)];
  const lastSearch = getGmailSearchSession(telegramId);
  if (lastSearch) {
    lines.push(formatGmailSearchSessionContext(lastSearch));
  }
  return lines.join("\n");
}

async function buildContextBlock(
  ctx: AgentContext,
  userText: string,
  pendingDelete: PendingDestructiveAction | null,
): Promise<string> {
  if (ctx.activeTripId === null) {
    const lines = [
      "There is no active trip selected.",
      "If the user wants to plan a trip, create one. If they only want to save a general interesting place, use save_interesting_place without creating a trip.",
      await gmailContextLine(ctx.telegramId),
      ...(await savedPlacesContextLines(ctx.telegramId)),
    ];
    return lines.join("\n");
  }
  const trip = await getTrip(ctx.telegramId, ctx.activeTripId);
  if (!trip) return "No active trip found.";

  const [memories, itinerary, reservations, savedPlaceLines] = await Promise.all([
    searchMemories({
      telegramId: ctx.telegramId,
      tripId: ctx.activeTripId,
      queryText: userText,
      limit: 6,
    }),
    getItinerary(ctx.activeTripId),
    listReservations(ctx.activeTripId),
    savedPlacesContextLines(ctx.telegramId),
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

  lines.push(...savedPlaceLines);
  lines.push(await gmailContextLine(ctx.telegramId));

  if (pendingDelete) {
    lines.push("\nPending destructive action awaiting explicit user confirmation:");
    lines.push(`- Tool: ${pendingDelete.toolName}`);
    lines.push(`- Args: ${JSON.stringify(pendingDelete.args)}`);
    lines.push(
      "- If the user's latest message clearly confirms this exact action, call the same tool with confirmed=true. If they decline or ask for anything else, do not delete.",
    );
  }

  return lines.join("\n");
}

export interface AgentResult {
  reply: string;
  files: string[];
}

async function runToolCall(
  ctx: AgentContext,
  toolName: string,
  rawArgs: string | undefined,
  options: {
    userText: string;
    pendingDeleteForTurn: PendingDestructiveAction | null;
    activeTripId: number | null;
    iteration: number;
  },
): Promise<unknown> {
  return getTracer().startActiveSpan("tool.call", async (span) => {
    const started = Date.now();
    span.setAttribute("tool.name", toolName);
    span.setAttribute("telegram.id", ctx.telegramId);
    span.setAttribute("agent.iteration", options.iteration);
    agentLog.info("tool start", {
      telegram_id: ctx.telegramId,
      tool: toolName,
      iteration: options.iteration,
    });

    const handler = toolHandlers[toolName];
    if (!handler) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "unknown tool" });
      agentLog.warn("unknown tool", {
        telegram_id: ctx.telegramId,
        tool: toolName,
        iteration: options.iteration,
        duration_ms: Date.now() - started,
      });
      span.end();
      return { error: `Unknown tool ${toolName}` };
    }

    try {
      const args = rawArgs ? JSON.parse(rawArgs) : {};
      let result: unknown;
      let outcome: "success" | "confirmation_required" = "success";
      if (DESTRUCTIVE_TOOL_NAMES.has(toolName)) {
        const canDelete =
          options.pendingDeleteForTurn &&
          isDestructiveConfirmation(options.userText) &&
          sameDestructiveAction(options.pendingDeleteForTurn, toolName, args);

        if (!canDelete) {
          const pendingAction = {
            toolName,
            args: destructiveArgsForComparison(args),
          };
          await savePendingDestructiveAction(ctx.telegramId, ctx.activeTripId, pendingAction);
          result = confirmationRequiredResult(toolName, args);
          outcome = "confirmation_required";
        } else {
          result = await handler(ctx, { ...args, confirmed: true });
          await clearPendingDestructiveAction(ctx.telegramId, options.activeTripId);
        }
      } else {
        result = await handler(ctx, args);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      agentLog.info("tool done", {
        telegram_id: ctx.telegramId,
        tool: toolName,
        iteration: options.iteration,
        result: outcome,
        duration_ms: Date.now() - started,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      agentLog.error("tool call failed", {
        telegram_id: ctx.telegramId,
        tool: toolName,
        iteration: options.iteration,
        error: message,
        duration_ms: Date.now() - started,
      });
      if (err instanceof Error) span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      return { error: message };
    } finally {
      span.end();
    }
  });
}

async function runAgentInner(telegramId: number, userText: string): Promise<AgentResult> {
  const started = Date.now();
  const activeTripId = await getActiveTripId(telegramId);
  const ctx: AgentContext = { telegramId, activeTripId, exports: [] };
  const pendingDelete = await getPendingDestructiveAction(telegramId, activeTripId);
  const isPendingConfirmation = pendingDelete !== null && isDestructiveConfirmation(userText);

  agentLog.info("handle start", {
    telegram_id: telegramId,
    active_trip_id: activeTripId ?? -1,
    text_len: userText.length,
    pending_delete: Boolean(pendingDelete),
  });

  if (pendingDelete && isDestructiveCancellation(userText)) {
    await saveMessage(telegramId, ctx.activeTripId, "user", userText);
    await clearPendingDestructiveAction(telegramId, ctx.activeTripId);
    const reply = "Ок, не удаляю.";
    await saveMessage(telegramId, ctx.activeTripId, "assistant", reply);
    agentLog.info("destructive action cancelled", {
      telegram_id: telegramId,
      tool: pendingDelete.toolName,
      duration_ms: Date.now() - started,
    });
    void extractMemories(telegramId, ctx.activeTripId, userText, reply).catch((err) =>
      memoryLog.error("extraction failed:", err),
    );
    return { reply, files: [] };
  }

  if (pendingDelete && !isPendingConfirmation) {
    await clearPendingDestructiveAction(telegramId, ctx.activeTripId);
    agentLog.info("pending destructive action cleared", {
      telegram_id: telegramId,
      tool: pendingDelete.toolName,
    });
  }

  const pendingDeleteForTurn = isPendingConfirmation ? pendingDelete : null;
  const history = await recentMessages(telegramId, activeTripId, 12);
  const contextBlock = await buildContextBlock(ctx, userText, pendingDeleteForTurn);

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
  let iterations = 0;
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    const iteration = i + 1;
    iterations = iteration;
    const llmStarted = Date.now();
    agentLog.info("llm request", {
      telegram_id: telegramId,
      iteration,
      model: config.openaiModel,
    });

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
      agentLog.info("llm final reply", {
        telegram_id: telegramId,
        iteration,
        reply_len: reply.length,
        duration_ms: Date.now() - llmStarted,
      });
      break;
    }

    const toolNames = toolCalls
      .filter((call) => call.type === "function")
      .map((call) => call.function.name)
      .join(",");
    agentLog.info("llm tool calls", {
      telegram_id: telegramId,
      iteration,
      tools: toolNames,
      tool_count: toolCalls.length,
      duration_ms: Date.now() - llmStarted,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const result = await runToolCall(ctx, call.function.name, call.function.arguments, {
        userText,
        pendingDeleteForTurn,
        activeTripId,
        iteration,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!reply) {
    reply = "Sorry, I got stuck working on that. Could you rephrase or try again?";
    agentLog.warn("max tool iterations reached", {
      telegram_id: telegramId,
      iterations,
    });
  }

  await saveMessage(telegramId, ctx.activeTripId, "assistant", reply);

  // Fire-and-forget structured memory extraction (does not block the reply).
  void extractMemories(telegramId, ctx.activeTripId, userText, reply).catch((err) =>
    memoryLog.error("extraction failed:", err),
  );

  agentLog.info("handle done", {
    telegram_id: telegramId,
    active_trip_id: ctx.activeTripId ?? -1,
    iterations,
    files: ctx.exports.length,
    reply_len: reply.length,
    duration_ms: Date.now() - started,
  });

  return { reply, files: ctx.exports };
}

export async function runAgent(telegramId: number, userText: string): Promise<AgentResult> {
  return withJobSpan("agent", async () => {
    const span = trace.getActiveSpan();
    span?.setAttribute("telegram.id", telegramId);
    span?.setAttribute("user.text_len", userText.length);
    return runAgentInner(telegramId, userText);
  });
}
