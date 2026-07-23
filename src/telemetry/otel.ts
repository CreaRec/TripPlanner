import { metrics, trace, SpanStatusCode, type Meter, type Tracer } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import * as resources from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { Logger } from "./logger";

const TRACER_NAME = "crea-trip-planner";
const METER_NAME = "crea-trip-planner";
/** Default metric push cadence (OTEL SDK default is 60s — too slow for bot dashboards). */
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 10_000;
const DEFAULT_METRIC_EXPORT_TIMEOUT_MS = 5_000;
const log = new Logger("telemetry");

let sdk: NodeSDK | null = null;
let started = false;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function readEndpoint(): string | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return raw ? normalizeEndpoint(raw) : undefined;
}

function readServiceVersion(): string {
  return (
    process.env.OTEL_SERVICE_VERSION?.trim() ||
    process.env.IMAGE_TAG?.trim() ||
    process.env.npm_package_version?.trim() ||
    "0.1.0"
  );
}

function readDeploymentEnvironment(): string {
  const explicit = process.env.OTEL_DEPLOYMENT_ENVIRONMENT?.trim();
  if (explicit) return explicit;
  const nodeEnv = process.env.NODE_ENV?.trim();
  if (nodeEnv === "development" || nodeEnv === "test") return "local";
  if (nodeEnv === "staging") return "staging";
  if (nodeEnv === "production") return "production";
  return nodeEnv || "production";
}

/** Positive millis from env, or `fallback`. Honours standard OTEL_* metric export knobs. */
function readPositiveMillis(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Exposed for tests. */
export function metricExportTiming(): {
  exportIntervalMillis: number;
  exportTimeoutMillis: number;
} {
  const exportIntervalMillis = readPositiveMillis(
    "OTEL_METRIC_EXPORT_INTERVAL",
    DEFAULT_METRIC_EXPORT_INTERVAL_MS,
  );
  const exportTimeoutMillis = Math.min(
    readPositiveMillis("OTEL_METRIC_EXPORT_TIMEOUT", DEFAULT_METRIC_EXPORT_TIMEOUT_MS),
    Math.max(1_000, exportIntervalMillis - 1_000),
  );
  return { exportIntervalMillis, exportTimeoutMillis };
}

export async function startTelemetry(): Promise<void> {
  if (started) return;

  const endpoint = readEndpoint();
  if (!endpoint) {
    log.info("OTEL_EXPORTER_OTLP_ENDPOINT unset — OpenTelemetry SDK not started.");
    started = true;
    return;
  }

  if (process.env.OTEL_SDK_DISABLED === "true") {
    log.info("OTEL_SDK_DISABLED=true — OpenTelemetry SDK not started.");
    started = true;
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "crea-trip-planner";
  const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE?.trim() || "bots";
  const deploymentEnvironment = readDeploymentEnvironment();
  const serviceVersion = readServiceVersion();

  // CreaGrafana contract: deployment.environment → Prometheus deployment_environment
  const resource = resources.resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    "deployment.environment": deploymentEnvironment,
  });

  try {
    sdk = new NodeSDK({
      resource,
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
          ...metricExportTiming(),
        }),
      ],
      logRecordProcessors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
        }),
      ],
    });
    sdk.start();
    started = true;
    log.info(`OpenTelemetry SDK started → ${endpoint}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to start OpenTelemetry SDK:", message);
    sdk = null;
    started = true;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  const active = sdk;
  sdk = null;
  try {
    await active.shutdown();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("shutdown failed:", message);
  }
}

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export function getMeter(): Meter {
  return metrics.getMeter(METER_NAME);
}

/** Run `fn` inside an active span so nested work and logs share one trace. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      if (err instanceof Error) span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Exposed for tests — whether the SDK process has been initialized (including no-op path). */
export function isTelemetryStarted(): boolean {
  return started;
}

/** Exposed for tests — whether a real SDK instance is running. */
export function isTelemetrySdkActive(): boolean {
  return sdk !== null;
}

/** Reset module state for unit tests. */
export function resetTelemetryForTests(): void {
  sdk = null;
  started = false;
}
