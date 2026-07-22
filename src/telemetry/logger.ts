import { context, trace } from "@opentelemetry/api";
import { logs, SeverityNumber, type Logger as OtelLogger } from "@opentelemetry/api-logs";

type LogLevel = "debug" | "info" | "warn" | "error";

const SEVERITY: Record<LogLevel, { number: SeverityNumber; text: string }> = {
  debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
  info: { number: SeverityNumber.INFO, text: "INFO" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
};

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function activeTraceAttributes(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  if (!spanContext.traceId || !spanContext.spanId) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

export class Logger {
  private readonly otel: OtelLogger;

  constructor(private readonly prefix: string) {
    this.otel = logs.getLogger(prefix);
  }

  debug(...args: unknown[]): void {
    this.emit("debug", args);
  }

  info(...args: unknown[]): void {
    this.emit("info", args);
  }

  warn(...args: unknown[]): void {
    this.emit("warn", args);
  }

  error(...args: unknown[]): void {
    this.emit("error", args);
  }

  private emit(level: LogLevel, args: unknown[]): void {
    const consoleArgs =
      args.length > 0 && typeof args[0] === "string"
        ? [`[${this.prefix}] ${args[0]}`, ...args.slice(1)]
        : [`[${this.prefix}]`, ...args];

    switch (level) {
      case "debug":
        console.debug(...consoleArgs);
        break;
      case "info":
        console.info(...consoleArgs);
        break;
      case "warn":
        console.warn(...consoleArgs);
        break;
      case "error":
        console.error(...consoleArgs);
        break;
    }

    const severity = SEVERITY[level];
    try {
      this.otel.emit({
        body: formatArgs(consoleArgs),
        severityNumber: severity.number,
        severityText: severity.text,
        attributes: activeTraceAttributes(),
      });
    } catch {
      // Never fail the app if log export misbehaves.
    }
  }
}
