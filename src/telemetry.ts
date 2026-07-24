import type { Context, MiddlewareFn } from "telegraf";
import { trace } from "@opentelemetry/api";
import {
  initTelemetry,
  isBotHandle,
  type BotResult,
  type BotTelemetryHandle,
} from "@crearec/otel";

const SERVICE_NAME = "crea-trip-planner";
const SERVICE_NAMESPACE = "bots";

type TelemetryState = {
  result: BotResult;
  handler: string;
  errorType?: string;
};

const stateByUpdate = new WeakMap<object, TelemetryState>();

let telemetry: BotTelemetryHandle | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function stateKey(ctx: Context): object {
  return ctx.update ?? ctx;
}

function getState(ctx: Context): TelemetryState | undefined {
  return stateByUpdate.get(stateKey(ctx));
}

function inferHandler(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) {
    if (ctx.callbackQuery) return "callback";
    return "update";
  }
  if ("text" in msg && typeof msg.text === "string") {
    if (msg.text === "/start") return "start";
    if (msg.text === "/help") return "help";
    if (msg.text.startsWith("/")) return "command";
    return "text";
  }
  if ("photo" in msg) return "photo";
  if ("document" in msg) return "document";
  return "message";
}

function classifyError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "TimeoutError") {
    return "timeout";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/openai|api key|rate limit/i.test(message)) return "openai";
  if (/telegram|403|429|ECONNREFUSED/i.test(message)) return "telegram";
  if (/ENOENT|EACCES|EPERM|filesystem|no such file/i.test(message)) return "fs";
  return "unknown";
}

function emitLog(
  tel: BotTelemetryHandle,
  severityText: "DEBUG" | "INFO" | "WARN" | "ERROR",
  body: string,
  attributes: Record<string, string>,
): void {
  try {
    tel.logger.emit({
      severityText,
      body,
      attributes,
    });
  } catch (err) {
    console.warn("[telemetry] log emit failed:", err);
  }
}

/** Bootstrap OTLP → Alloy. Safe to call once at process start. */
export function startTelemetry(): BotTelemetryHandle {
  if (telemetry) return telemetry;

  const tel = initTelemetry({
    kind: "bot",
    serviceName: readEnv("OTEL_SERVICE_NAME") ?? SERVICE_NAME,
    serviceNamespace: readEnv("OTEL_SERVICE_NAMESPACE") ?? SERVICE_NAMESPACE,
    deploymentEnvironment: readEnv("DEPLOY_ENV") ?? "local",
    serviceVersion: readEnv("OTEL_SERVICE_VERSION"),
    endpoint: readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  });

  if (!isBotHandle(tel)) {
    throw new Error("expected @crearec/otel kind: bot");
  }

  tel.bot.setUp(true);
  telemetry = tel;
  return tel;
}

export function getTelemetry(): BotTelemetryHandle {
  if (!telemetry) {
    throw new Error("telemetry not started; call startTelemetry() first");
  }
  return telemetry;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetry) return;
  telemetry.bot.setUp(false);
  await telemetry.shutdown();
  telemetry = null;
}

/** Mark the current update as skipped (auth reject, ignored command, …). */
export function markUpdateSkipped(ctx: Context, handler?: string): void {
  const state = getState(ctx);
  if (!state) return;
  state.result = "skipped";
  if (handler) state.handler = handler;
}

/** Refine low-cardinality handler label before the update finishes. */
export function setUpdateHandler(ctx: Context, handler: string): void {
  const state = getState(ctx);
  if (!state) return;
  state.handler = handler;
}

/**
 * Record an application error for the current update without rethrowing.
 * Still sets result=error so counter + histogram stay aligned.
 */
export function markUpdateError(
  ctx: Context,
  err: unknown,
  options?: { errorType?: string; handler?: string },
): void {
  const state = getState(ctx);
  const handler = options?.handler ?? state?.handler ?? inferHandler(ctx);
  const errorType = options?.errorType ?? classifyError(err);

  if (state) {
    state.result = "error";
    state.handler = handler;
    state.errorType = errorType;
  }

  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    if (err instanceof Error) {
      activeSpan.recordException(err);
    }
    activeSpan.setStatus({ code: 2, message: errorType });
    activeSpan.setAttribute("error.type", errorType);
  }

  try {
    const tel = getTelemetry();
    tel.bot.recordError({ errorType, handler });
    const traceId = activeSpan?.spanContext().traceId;
    emitLog(tel, "ERROR", `[bot] handler error handler=${handler} error_type=${errorType}`, {
      handler,
      result: "error",
      error_type: errorType,
      ...(traceId ? { trace_id: traceId } : {}),
    });
  } catch {
    // Telemetry must not break business logic (tests without startTelemetry, export failures).
  }
}

/**
 * Root middleware: one `bot.handle_update` span per Telegram update, and
 * always emit `bot_handler_duration_seconds` + `bot_updates_total` together.
 */
export function telemetryMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const tel = getTelemetry();
    const state: TelemetryState = {
      result: "success",
      handler: inferHandler(ctx),
    };
    stateByUpdate.set(stateKey(ctx), state);

    await tel.tracer.startActiveSpan("bot.handle_update", async (span) => {
      const started = process.hrtime.bigint();
      const traceId = span.spanContext().traceId;

      try {
        await next();
      } catch (err) {
        state.result = "error";
        const alreadyRecorded = state.errorType !== undefined;
        const errorType = state.errorType ?? classifyError(err);
        state.errorType = errorType;
        if (!alreadyRecorded) {
          try {
            tel.bot.recordError({ errorType, handler: state.handler });
          } catch {
            // ignore
          }
          emitLog(
            tel,
            "ERROR",
            `[bot] update failed handler=${state.handler} error_type=${errorType} trace_id=${traceId}`,
            {
              handler: state.handler,
              result: "error",
              error_type: errorType,
              trace_id: traceId,
            },
          );
        }
        if (err instanceof Error) {
          span.recordException(err);
        }
        span.setStatus({ code: 2, message: errorType });
        throw err;
      } finally {
        const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
        try {
          tel.bot.recordHandledUpdate({
            result: state.result,
            durationSeconds,
            handler: state.handler,
          });
        } catch (err) {
          console.warn("[telemetry] metric emit failed:", err);
        }

        if (state.result !== "error") {
          emitLog(
            tel,
            "INFO",
            `[bot] update handled handler=${state.handler} result=${state.result} trace_id=${traceId}`,
            {
              handler: state.handler,
              result: state.result,
              trace_id: traceId,
            },
          );
        }

        span.setAttribute("result", state.result);
        span.setAttribute("handler", state.handler);
        if (state.errorType) {
          span.setAttribute("error.type", state.errorType);
        }
        span.end();
        stateByUpdate.delete(stateKey(ctx));
      }
    });
  };
}
