import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyErrorType,
  CONTRACT_METRIC_NAMES,
  CONTRACT_SPAN_NAMES,
  HandledUpdateError,
  resetBotMetricsForTests,
  setBotUp,
  trackError,
  trackUpdate,
  withJobSpan,
} from "./botMetrics";

describe("telemetry/botMetrics", () => {
  afterEach(() => {
    resetBotMetricsForTests();
    vi.restoreAllMocks();
  });

  it("exports only contract metric and span names", () => {
    expect(CONTRACT_METRIC_NAMES).toEqual([
      "bot_updates_total",
      "bot_handler_duration_seconds",
      "bot_errors_total",
      "bot_up",
    ]);
    expect(CONTRACT_SPAN_NAMES.handleUpdate).toBe("bot.handle_update");
    expect(CONTRACT_SPAN_NAMES.jobAgent).toBe("bot.job.agent");
    expect(CONTRACT_SPAN_NAMES.jobVision).toBe("bot.job.vision");
    expect(CONTRACT_SPAN_NAMES.jobGmail).toBe("bot.job.gmail");
    expect(CONTRACT_SPAN_NAMES.command).toBe("bot.command");
  });

  it("classifyErrorType maps known errors", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(classifyErrorType(timeout)).toBe("timeout");
    expect(classifyErrorType(new Error("Telegram file download failed"))).toBe("telegram");
    expect(classifyErrorType(new Error("OpenAI rate limit"))).toBe("openai");
    expect(classifyErrorType(new Error("gmail oauth failed"))).toBe("gmail");
    expect(classifyErrorType(new Error("boom"))).toBe("unknown");
    expect(classifyErrorType(new HandledUpdateError("openai"))).toBe("openai");
  });

  it("metric helpers do not throw without a real SDK", () => {
    expect(() => {
      setBotUp(1);
      trackUpdate({
        handler: "message",
        result: "success",
        durationSec: 0.01,
      });
      trackUpdate({
        handler: "message",
        result: "error",
        durationSec: 0.02,
        error_type: "unknown",
      });
      trackUpdate({
        handler: "message",
        result: "skipped",
        durationSec: 0,
      });
      trackError({ error_type: "telegram", handler: "message" });
      setBotUp(0);
    }).not.toThrow();
  });

  it("withJobSpan runs work under bot.job.* span name", async () => {
    await expect(withJobSpan("agent", async () => "ok")).resolves.toBe("ok");
  });

  it("HandledUpdateError preserves errorType", () => {
    const err = new HandledUpdateError("gmail", new Error("oauth failed"));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HandledUpdateError");
    expect(err.errorType).toBe("gmail");
  });
});
