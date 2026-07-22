import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTelemetrySdkActive,
  isTelemetryStarted,
  resetTelemetryForTests,
  shutdownTelemetry,
  startTelemetry,
} from "./otel";

describe("telemetry/otel", () => {
  afterEach(async () => {
    await shutdownTelemetry();
    resetTelemetryForTests();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SDK_DISABLED;
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
    expect(info).toHaveBeenCalledWith(expect.stringContaining("OTEL_SDK_DISABLED"));
  });
});
