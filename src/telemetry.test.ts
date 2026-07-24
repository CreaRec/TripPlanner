import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const otel = vi.hoisted(() => {
  const span = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ traceId: "trace-abc" }),
  };
  const bot = {
    recordHandledUpdate: vi.fn(),
    recordError: vi.fn(),
    setUp: vi.fn(),
  };
  const logger = { emit: vi.fn() };
  const tracer = {
    startActiveSpan: vi.fn(async (_name: string, fn: (span: typeof span) => Promise<void>) => fn(span)),
  };
  return {
    span,
    bot,
    logger,
    tracer,
    initTelemetry: vi.fn(() => ({
      kind: "bot" as const,
      serviceName: "crea-trip-planner",
      serviceNamespace: "bots",
      tracer,
      meter: {},
      logger,
      bot,
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
    isBotHandle: (tel: { kind: string; bot?: unknown }) => tel.kind === "bot" && tel.bot !== undefined,
  };
});

vi.mock("@crearec/otel", () => ({
  initTelemetry: otel.initTelemetry,
  isBotHandle: otel.isBotHandle,
}));

describe("telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    otel.bot.recordHandledUpdate.mockClear();
    otel.bot.recordError.mockClear();
    otel.bot.setUp.mockClear();
    otel.logger.emit.mockClear();
    otel.span.setAttribute.mockClear();
    otel.span.setStatus.mockClear();
    otel.span.recordException.mockClear();
    otel.span.end.mockClear();
    otel.tracer.startActiveSpan.mockClear();
    otel.initTelemetry.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts bot telemetry with contract defaults", async () => {
    const { startTelemetry, shutdownTelemetry } = await import("./telemetry");
    const tel = startTelemetry();
    expect(otel.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "bot",
        serviceName: "crea-trip-planner",
        serviceNamespace: "bots",
      }),
    );
    expect(otel.bot.setUp).toHaveBeenCalledWith(true);
    expect(tel.serviceName).toBe("crea-trip-planner");
    await shutdownTelemetry();
    expect(otel.bot.setUp).toHaveBeenCalledWith(false);
  });

  it("records duration and updates together on success", async () => {
    const { startTelemetry, telemetryMiddleware, shutdownTelemetry } = await import("./telemetry");
    startTelemetry();
    const middleware = telemetryMiddleware();
    const ctx = { update: { update_id: 1 }, message: { text: "plan a trip" } };
    await middleware(ctx as never, async () => undefined);

    expect(otel.bot.recordHandledUpdate).toHaveBeenCalledTimes(1);
    expect(otel.bot.recordHandledUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "success",
        handler: "text",
        durationSeconds: expect.any(Number),
      }),
    );
    expect(otel.bot.recordError).not.toHaveBeenCalled();
    expect(otel.logger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        attributes: expect.objectContaining({ result: "success", handler: "text", trace_id: "trace-abc" }),
      }),
    );
    expect(otel.span.end).toHaveBeenCalled();
    await shutdownTelemetry();
  });

  it("marks auth rejects as skipped and still increments the counter", async () => {
    const {
      startTelemetry,
      telemetryMiddleware,
      markUpdateSkipped,
      shutdownTelemetry,
    } = await import("./telemetry");
    startTelemetry();
    const middleware = telemetryMiddleware();
    const ctx = { update: { update_id: 2 }, message: { text: "hi" } };
    await middleware(ctx as never, async () => {
      markUpdateSkipped(ctx as never, "auth");
    });

    expect(otel.bot.recordHandledUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ result: "skipped", handler: "auth" }),
    );
    expect(otel.bot.recordError).not.toHaveBeenCalled();
    await shutdownTelemetry();
  });

  it("records error counter + handled update together when next throws", async () => {
    const { startTelemetry, telemetryMiddleware, shutdownTelemetry } = await import("./telemetry");
    startTelemetry();
    const middleware = telemetryMiddleware();
    const ctx = { update: { update_id: 3 }, message: { text: "boom" } };
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });

    await expect(
      middleware(ctx as never, async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(otel.bot.recordError).toHaveBeenCalledWith({ errorType: "timeout", handler: "text" });
    expect(otel.bot.recordHandledUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ result: "error", handler: "text" }),
    );
    expect(otel.span.recordException).toHaveBeenCalledWith(err);
    expect(otel.logger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "ERROR",
        attributes: expect.objectContaining({ result: "error", error_type: "timeout" }),
      }),
    );
    await shutdownTelemetry();
  });

  it("records application errors without rethrowing when markUpdateError is used", async () => {
    const {
      startTelemetry,
      telemetryMiddleware,
      markUpdateError,
      setUpdateHandler,
      shutdownTelemetry,
    } = await import("./telemetry");
    startTelemetry();
    const middleware = telemetryMiddleware();
    const ctx = { update: { update_id: 4 }, message: { text: "agent please" } };

    await middleware(ctx as never, async () => {
      setUpdateHandler(ctx as never, "agent");
      markUpdateError(ctx as never, new Error("openai failed"), { errorType: "openai" });
    });

    expect(otel.bot.recordError).toHaveBeenCalledWith({ errorType: "openai", handler: "agent" });
    expect(otel.bot.recordHandledUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ result: "error", handler: "agent" }),
    );
    await shutdownTelemetry();
  });
});
