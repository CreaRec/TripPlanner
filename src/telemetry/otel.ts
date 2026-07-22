import { metrics, trace, type Meter, type Tracer } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import * as resources from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
} from "@opentelemetry/semantic-conventions";
import { Logger } from "./logger";

const TRACER_NAME = "crea-trip-planner";
const METER_NAME = "crea-trip-planner";
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
  const deploymentEnvironment = process.env.NODE_ENV?.trim() || "production";

  const resource = resources.resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: deploymentEnvironment,
  });

  try {
    sdk = new NodeSDK({
      resource,
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
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
