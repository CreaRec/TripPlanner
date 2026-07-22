import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginInflight,
  classifyErrorType,
  CONTRACT_METRIC_NAMES,
  CONTRACT_SPAN_NAMES,
  endInflight,
  resetBotMetricsForTests,
  trackCommand,
  trackError,
  trackJob,
  trackUpdate,
  withJob,
} from "./botMetrics";

describe("telemetry/botMetrics", () => {
  afterEach(() => {
    resetBotMetricsForTests();
    vi.restoreAllMocks();
  });

  it("exports contract metric and span names", () => {
    expect(CONTRACT_METRIC_NAMES).toEqual(
      expect.arrayContaining([
        "bot_updates_total",
        "bot_commands_total",
        "bot_handler_duration_seconds",
        "bot_errors_total",
        "bot_inflight",
        "bot_jobs_total",
        "bot_job_duration_seconds",
        "bot_job_bytes_total",
      ]),
    );
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
  });

  it("metric helpers do not throw without a real SDK", () => {
    expect(() => {
      beginInflight("message");
      trackUpdate({
        update_kind: "message",
        handler: "message",
        result: "success",
        durationSec: 0.01,
      });
      endInflight("message");
      trackCommand({ command: "/start", result: "success" });
      trackError({ error_type: "unknown", handler: "message" });
      trackJob({ job: "agent", result: "success", durationSec: 0.02 });
    }).not.toThrow();
  });

  it("withJob runs work under bot.job.* span name", async () => {
    await expect(withJob("agent", async () => "ok")).resolves.toBe("ok");
  });
});
