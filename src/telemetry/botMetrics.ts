import type { Counter, Histogram, UpDownCounter } from "@opentelemetry/api";
import { getMeter, withSpan } from "./otel";

/** CreaGrafana telemetry-contract metric / label enums. */

export type MetricResult = "success" | "error" | "skipped";
export type UpdateKind = "message" | "command";
export type HandlerName = "message" | "vision" | "gmail_connect" | "gmail_export" | "command";
export type JobName = "agent" | "vision" | "gmail";
export type ErrorType = "timeout" | "telegram" | "openai" | "gmail" | "unknown";
export type ByteDirection = "in" | "out";

export const CONTRACT_METRIC_NAMES = [
  "bot_updates_total",
  "bot_commands_total",
  "bot_handler_duration_seconds",
  "bot_errors_total",
  "bot_inflight",
  "bot_jobs_total",
  "bot_job_duration_seconds",
  "bot_job_bytes_total",
] as const;

export const CONTRACT_SPAN_NAMES = {
  handleUpdate: "bot.handle_update",
  command: "bot.command",
  jobAgent: "bot.job.agent",
  jobVision: "bot.job.vision",
  jobGmail: "bot.job.gmail",
} as const;

let updatesTotal: Counter | undefined;
let commandsTotal: Counter | undefined;
let errorsTotal: Counter | undefined;
let jobsTotal: Counter | undefined;
let jobBytesTotal: Counter | undefined;
let handlerDuration: Histogram | undefined;
let jobDuration: Histogram | undefined;
let inflight: UpDownCounter | undefined;

function getUpdatesTotal(): Counter {
  if (!updatesTotal) {
    updatesTotal = getMeter().createCounter("bot_updates_total", {
      description: "Inbound Telegram updates handled",
    });
  }
  return updatesTotal;
}

function getCommandsTotal(): Counter {
  if (!commandsTotal) {
    commandsTotal = getMeter().createCounter("bot_commands_total", {
      description: "Slash commands handled",
    });
  }
  return commandsTotal;
}

function getErrorsTotal(): Counter {
  if (!errorsTotal) {
    errorsTotal = getMeter().createCounter("bot_errors_total", {
      description: "Explicit application errors",
    });
  }
  return errorsTotal;
}

function getJobsTotal(): Counter {
  if (!jobsTotal) {
    jobsTotal = getMeter().createCounter("bot_jobs_total", {
      description: "Job attempts",
    });
  }
  return jobsTotal;
}

function getJobBytesTotal(): Counter {
  if (!jobBytesTotal) {
    jobBytesTotal = getMeter().createCounter("bot_job_bytes_total", {
      description: "Bytes transferred by jobs",
    });
  }
  return jobBytesTotal;
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

function getJobDuration(): Histogram {
  if (!jobDuration) {
    jobDuration = getMeter().createHistogram("bot_job_duration_seconds", {
      description: "Job latency",
      unit: "s",
    });
  }
  return jobDuration;
}

function getInflight(): UpDownCounter {
  if (!inflight) {
    inflight = getMeter().createUpDownCounter("bot_inflight", {
      description: "In-progress handlers",
    });
  }
  return inflight;
}

export function classifyErrorType(err: unknown): ErrorType {
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

export function beginInflight(handler: HandlerName): void {
  getInflight().add(1, { handler });
}

export function endInflight(handler: HandlerName): void {
  getInflight().add(-1, { handler });
}

export function trackUpdate(options: {
  update_kind: UpdateKind;
  handler: HandlerName;
  result: MetricResult;
  durationSec: number;
  error_type?: ErrorType;
}): void {
  getUpdatesTotal().add(1, {
    result: options.result,
    update_kind: options.update_kind,
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

export function trackCommand(options: {
  command: string;
  result: MetricResult;
}): void {
  getCommandsTotal().add(1, {
    command: options.command,
    result: options.result,
  });
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

export function trackJob(options: {
  job: JobName;
  result: MetricResult;
  durationSec: number;
  bytes?: number;
  direction?: ByteDirection;
}): void {
  getJobsTotal().add(1, { job: options.job, result: options.result });
  getJobDuration().record(options.durationSec, {
    job: options.job,
    result: options.result,
  });
  if (
    typeof options.bytes === "number" &&
    options.bytes > 0 &&
    options.direction
  ) {
    getJobBytesTotal().add(options.bytes, {
      job: options.job,
      direction: options.direction,
    });
  }
}

/** Run work inside `bot.job.<name>` and record job metrics. */
export async function withJob<T>(
  job: JobName,
  fn: () => Promise<T>,
  options?: {
    bytes?: () => number | Promise<number | undefined> | undefined;
    direction?: ByteDirection;
    resultForValue?: (value: T) => MetricResult;
  },
): Promise<T> {
  const started = Date.now();
  return withSpan(`bot.job.${job}`, { "bot.job": job }, async () => {
    try {
      const value = await fn();
      const result = options?.resultForValue?.(value) ?? "success";
      const bytes = options?.bytes ? await options.bytes() : undefined;
      trackJob({
        job,
        result,
        durationSec: (Date.now() - started) / 1000,
        bytes: typeof bytes === "number" ? bytes : undefined,
        direction: options?.direction,
      });
      return value;
    } catch (err) {
      trackJob({
        job,
        result: "error",
        durationSec: (Date.now() - started) / 1000,
      });
      throw err;
    }
  });
}

/** Reset lazy instrument handles (unit tests). */
export function resetBotMetricsForTests(): void {
  updatesTotal = undefined;
  commandsTotal = undefined;
  errorsTotal = undefined;
  jobsTotal = undefined;
  jobBytesTotal = undefined;
  handlerDuration = undefined;
  jobDuration = undefined;
  inflight = undefined;
}
