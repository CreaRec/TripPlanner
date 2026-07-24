import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const otelApi = vi.hoisted(() => ({
  getActiveSpan: vi.fn(() => ({
    spanContext: () => ({ traceId: "trace-log-1" }),
  })),
}));

vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: otelApi.getActiveSpan },
}));

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    otelApi.getActiveSpan.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mirrors to console and emits OTEL logs with severity and trace_id", async () => {
    const emit = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { bindOtelLogger, logger } = await import("./log");
    bindOtelLogger({ emit });

    logger.info("[test] hello", { component: "test", step: "start" });

    expect(logSpy).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        body: "[test] hello",
        attributes: expect.objectContaining({
          component: "test",
          step: "start",
          trace_id: "trace-log-1",
        }),
      }),
    );

    bindOtelLogger(null);
  });

  it("falls back to console when OTEL logger is unbound", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bindOtelLogger, logger } = await import("./log");
    bindOtelLogger(null);

    logger.exception("[test] boom", new Error("nope"), { component: "test" });

    expect(errorSpy).toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[test] boom");
    expect(logged).toContain("error_message");
  });
});
