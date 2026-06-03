import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./systemPrompt";

describe("SYSTEM_PROMPT", () => {
  it("asks for missing route endpoints instead of claiming Routes is unavailable", () => {
    expect(SYSTEM_PROMPT).toContain("Only use it when both origin and destination are known");
    expect(SYSTEM_PROMPT).toContain("ask where they are starting from");
    expect(SYSTEM_PROMPT).toContain("Missing origin/destination is not an API failure");
  });
});
