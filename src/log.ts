import { trace } from "@opentelemetry/api";

export type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogAttributes = Record<string, string | number | boolean | undefined>;

type TelemetryLogger = {
  emit(record: {
    severityText: string;
    body: string;
    attributes?: Record<string, string>;
  }): void;
};

/** Injected by telemetry bootstrap; null until startTelemetry() / after shutdown. */
let otelLogger: TelemetryLogger | null = null;

export function bindOtelLogger(logger: TelemetryLogger | null): void {
  otelLogger = logger;
}

function toStringAttrs(attributes: LogAttributes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Application logger: mirrors to console and emits OTEL logs (Loki via Alloy)
 * with explicit severityText. Attaches active trace_id when present.
 * Never throws; telemetry failures must not block business logic.
 */
export function log(severity: LogSeverity, message: string, attributes: LogAttributes = {}): void {
  const attrs = toStringAttrs(attributes);
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  if (traceId && !attrs.trace_id) {
    attrs.trace_id = traceId;
  }

  const consolePayload = Object.keys(attrs).length > 0 ? `${message} ${JSON.stringify(attrs)}` : message;
  switch (severity) {
    case "ERROR":
      console.error(consolePayload);
      break;
    case "WARN":
      console.warn(consolePayload);
      break;
    case "DEBUG":
      console.debug(consolePayload);
      break;
    default:
      console.log(consolePayload);
  }

  if (!otelLogger) return;
  try {
    otelLogger.emit({
      severityText: severity,
      body: message,
      attributes: attrs,
    });
  } catch (err) {
    console.warn(`[log] otel emit failed: ${errorMessage(err)}`);
  }
}

export const logger = {
  debug(message: string, attributes?: LogAttributes): void {
    log("DEBUG", message, attributes);
  },
  info(message: string, attributes?: LogAttributes): void {
    log("INFO", message, attributes);
  },
  warn(message: string, attributes?: LogAttributes): void {
    log("WARN", message, attributes);
  },
  error(message: string, attributes?: LogAttributes): void {
    log("ERROR", message, attributes);
  },
  /** Convenience for catch blocks: message + error_message attribute. */
  exception(message: string, err: unknown, attributes?: LogAttributes): void {
    log("ERROR", message, {
      ...attributes,
      error_message: errorMessage(err),
      error_name: err instanceof Error ? err.name : "unknown",
    });
  },
};
