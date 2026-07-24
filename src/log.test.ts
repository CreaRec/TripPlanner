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

  it("mirrors to console and emits OTEL logs with severity, body summary, and trace_id", async () => {
    const emit = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { bindOtelLogger, logger } = await import("./log");
    bindOtelLogger({ emit });

    logger.info("[test] hello", {
      component: "test",
      step: "start",
      handler: "agent",
      user_text: "plan paris",
    });

    expect(logSpy).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        body: "[test] hello handler=agent step=start user_text=plan paris",
        attributes: expect.objectContaining({
          component: "test",
          step: "start",
          handler: "agent",
          user_text: "plan paris",
          trace_id: "trace-log-1",
        }),
      }),
    );

    bindOtelLogger(null);
  });

  it("truncates long user text for log previews", async () => {
    const { truncateForLog, LOG_USER_TEXT_MAX } = await import("./log");
    const long = "a".repeat(LOG_USER_TEXT_MAX + 50);
    const preview = truncateForLog(long);
    expect(preview.length).toBe(LOG_USER_TEXT_MAX);
    expect(preview.endsWith("…")).toBe(true);
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
