import type { Counter, Gauge, Histogram } from "@opentelemetry/api";
import { getMeter, withSpan } from "./otel";

/** CreaGrafana telemetry-contract metric / label enums. */

export type MetricResult = "success" | "error" | "skipped";
export type HandlerName = "message" | "vision" | "gmail_connect" | "gmail_export" | "command";
export type JobName = "agent" | "vision" | "gmail";
export type ErrorType = "timeout" | "telegram" | "openai" | "gmail" | "unknown";

export const CONTRACT_METRIC_NAMES = [
  "bot_updates_total",
  "bot_handler_duration_seconds",
  "bot_errors_total",
  "bot_up",
] as const;

export const CONTRACT_SPAN_NAMES = {
  handleUpdate: "bot.handle_update",
  command: "bot.command",
  jobAgent: "bot.job.agent",
  jobVision: "bot.job.vision",
  jobGmail: "bot.job.gmail",
} as const;

/** Error already answered to the user; record as update error without bubbling to bot.catch. */
export class HandledUpdateError extends Error {
  readonly errorType: ErrorType;

  constructor(errorType: ErrorType, cause?: unknown) {
    const message =
      cause instanceof Error ? cause.message : cause != null ? String(cause) : errorType;
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = "HandledUpdateError";
    this.errorType = errorType;
  }
}

let updatesTotal: Counter | undefined;
let errorsTotal: Counter | undefined;
let handlerDuration: Histogram | undefined;
let botUp: Gauge | undefined;

function getUpdatesTotal(): Counter {
  if (!updatesTotal) {
    updatesTotal = getMeter().createCounter("bot_updates_total", {
      description: "Inbound Telegram updates handled",
    });
  }
  return updatesTotal;
}

function getErrorsTotal(): Counter {
  if (!errorsTotal) {
    errorsTotal = getMeter().createCounter("bot_errors_total", {
      description: "Explicit application errors",
    });
  }
  return errorsTotal;
}

function getHandlerDuration(): Histogram {
  if (!handlerDuration) {
    handlerDuration = getMeter().createHistogram("bot_handler_duration_seconds", {
      description: "Handler latency",
      unit: "s",
    });
  }
  return handlerDuration;
}

function getBotUp(): Gauge {
  if (!botUp) {
    botUp = getMeter().createGauge("bot_up", {
      description: "1 while the process is healthy",
    });
  }
  return botUp;
}

export function classifyErrorType(err: unknown): ErrorType {
  if (err instanceof HandledUpdateError) return err.errorType;
  if (!(err instanceof Error)) return "unknown";
  if (err.name === "TimeoutError") return "timeout";
  const message = err.message.toLowerCase();
  if (message.includes("telegram") || message.includes("file download")) return "telegram";
  if (
    message.includes("openai") ||
    message.includes("rate limit") ||
    message.includes("chat.completions")
  ) {
    return "openai";
  }
  if (
    message.includes("gmail") ||
    message.includes("oauth") ||
    message.includes("google")
  ) {
    return "gmail";
  }
  return "unknown";
}

export function setBotUp(value: 0 | 1): void {
  getBotUp().record(value);
}

export function trackUpdate(options: {
  handler: HandlerName;
  result: MetricResult;
  durationSec: number;
  error_type?: ErrorType;
}): void {
  getUpdatesTotal().add(1, {
    result: options.result,
  });
  getHandlerDuration().record(options.durationSec, {
    handler: options.handler,
    result: options.result,
  });
  if (options.result === "error") {
    trackError({
      error_type: options.error_type ?? "unknown",
      handler: options.handler,
    });
  }
}

export function trackError(options: {
  error_type: ErrorType;
  handler: HandlerName;
}): void {
  getErrorsTotal().add(1, {
    error_type: options.error_type,
    handler: options.handler,
  });
}

/** Run work inside `bot.job.<name>` (traces only; no job metrics). */
export async function withJobSpan<T>(job: JobName, fn: () => Promise<T>): Promise<T> {
  return withSpan(`bot.job.${job}`, { "bot.job": job }, fn);
}

/** Reset lazy instrument handles (unit tests). */
export function resetBotMetricsForTests(): void {
  updatesTotal = undefined;
  errorsTotal = undefined;
  handlerDuration = undefined;
  botUp = undefined;
}
