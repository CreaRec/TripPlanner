import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTelemetrySdkActive,
  isTelemetryStarted,
  metricExportTiming,
  resetTelemetryForTests,
  shutdownTelemetry,
  startTelemetry,
  withSpan,
} from "./otel";

describe("telemetry/otel", () => {
  afterEach(async () => {
    await shutdownTelemetry();
    resetTelemetryForTests();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SDK_DISABLED;
    delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
    delete process.env.OTEL_METRIC_EXPORT_TIMEOUT;
    vi.restoreAllMocks();
  });

  it("startTelemetry does not throw when endpoint is unset", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(startTelemetry()).resolves.toBeUndefined();
    expect(isTelemetryStarted()).toBe(true);
    expect(isTelemetrySdkActive()).toBe(false);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("OTEL_EXPORTER_OTLP_ENDPOINT unset"),
    );
  });

  it("shutdownTelemetry is safe when SDK was never started", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it("skips SDK when OTEL_SDK_DISABLED=true even with endpoint", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://alloy:4318";
    process.env.OTEL_SDK_DISABLED = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await startTelemetry();
    expect(isTelemetrySdkActive()).toBe(false);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("OTEL_SDK_DISABLED"),
    );
  });

  it("withSpan runs the callback and does not throw without a real SDK", async () => {
    await expect(
      withSpan("test.span", { "telegram.id": 1 }, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("metricExportTiming defaults to 10s interval with shorter timeout", () => {
    expect(metricExportTiming()).toEqual({
      exportIntervalMillis: 10_000,
      exportTimeoutMillis: 5_000,
    });
  });

  it("metricExportTiming honours OTEL_METRIC_EXPORT_INTERVAL and caps timeout", () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = "5000";
    process.env.OTEL_METRIC_EXPORT_TIMEOUT = "8000";
    expect(metricExportTiming()).toEqual({
      exportIntervalMillis: 5_000,
      exportTimeoutMillis: 4_000,
    });
  });

  it("metricExportTiming ignores non-positive env values", () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = "0";
    process.env.OTEL_METRIC_EXPORT_TIMEOUT = "-1";
    expect(metricExportTiming()).toEqual({
      exportIntervalMillis: 10_000,
      exportTimeoutMillis: 5_000,
    });
  });
});
