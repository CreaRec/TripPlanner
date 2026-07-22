import { afterEach, describe, expect, it, vi } from "vitest";
import { logs } from "@opentelemetry/api-logs";
import { Logger } from "./logger";

describe("telemetry/logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to console and emits an OTEL log record", () => {
    const emit = vi.fn();
    vi.spyOn(logs, "getLogger").mockReturnValue({ emit } as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const log = new Logger("bot");
    log.error("failed to send file:", "photo.jpg");

    expect(error).toHaveBeenCalledWith("[bot] failed to send file:", "photo.jpg");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "[bot] failed to send file: photo.jpg",
        severityText: "ERROR",
      }),
    );
  });

  it("copies scalar fields from plain objects into OTEL attributes", () => {
    const emit = vi.fn();
    vi.spyOn(logs, "getLogger").mockReturnValue({ emit } as never);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const log = new Logger("agent");
    log.info("tool done", {
      telegram_id: 111,
      tool: "create_trip",
      duration_ms: 42,
      nested: { ignored: true },
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        attributes: expect.objectContaining({
          telegram_id: 111,
          tool: "create_trip",
          duration_ms: 42,
        }),
      }),
    );
    expect(emit.mock.calls[0][0].attributes.nested).toBeUndefined();
  });

  it("does not throw when OTEL emit fails", () => {
    vi.spyOn(logs, "getLogger").mockReturnValue({
      emit: () => {
        throw new Error("otlp down");
      },
    } as never);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const log = new Logger("startup");
    expect(() => log.info("still works")).not.toThrow();
  });
});
