import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./systemPrompt";

describe("SYSTEM_PROMPT", () => {
  it("asks for missing route endpoints instead of claiming Routes is unavailable", () => {
    expect(SYSTEM_PROMPT).toContain("Only use it when both origin and destination are known");
    expect(SYSTEM_PROMPT).toContain("ask where they are starting from");
    expect(SYSTEM_PROMPT).toContain("Missing origin/destination is not an API failure");
  });

  it("generates Static Maps only for visual route comparison requests", () => {
    expect(SYSTEM_PROMPT).toContain("include_maps=true");
    expect(SYSTEM_PROMPT).toContain("picture/map/image");
    expect(SYSTEM_PROMPT).toContain("Do not generate Static Maps images unless the user asks");
  });

  it("uses explicit stop_query when the user names a detour stop", () => {
    expect(SYSTEM_PROMPT).toContain("stop_query");
    expect(SYSTEM_PROMPT).toContain("Do not substitute a saved place candidate");
  });

  it("fetches weather only when the user asks", () => {
    expect(SYSTEM_PROMPT).toContain("Only call get_weather when the user explicitly asks");
    expect(SYSTEM_PROMPT).toContain("Do not fetch weather proactively");
  });

  it("uses search_gmail for email lookup requests across all inboxes", () => {
    expect(SYSTEM_PROMPT).toContain("search_gmail");
    expect(SYSTEM_PROMPT).toContain("export_gmail_message");
    expect(SYSTEM_PROMPT).toContain("do not search again");
    expect(SYSTEM_PROMPT).toContain("PDF file is attached");
    expect(SYSTEM_PROMPT).toContain("Always search all connected accounts");
    expect(SYSTEM_PROMPT).toContain("Do not include Gmail links");
    expect(SYSTEM_PROMPT).toContain("подключить почту");
    expect(SYSTEM_PROMPT).toContain("connect gmail");
    expect(SYSTEM_PROMPT).not.toContain("/connect_gmail");
    expect(SYSTEM_PROMPT).not.toContain("gmail_search_urls");
  });

  it("uses gmail account tools for connect, list, and disconnect requests", () => {
    expect(SYSTEM_PROMPT).toContain("start_gmail_connect");
    expect(SYSTEM_PROMPT).toContain("connect_url");
    expect(SYSTEM_PROMPT).toContain("добавь аккаунт");
    expect(SYSTEM_PROMPT).toContain("list_gmail_accounts");
    expect(SYSTEM_PROMPT).toContain("disconnect_gmail_account");
    expect(SYSTEM_PROMPT).toContain("disconnecting a Gmail inbox");
  });

  it("does not claim a map is attached unless generation succeeded", () => {
    expect(SYSTEM_PROMPT).toContain("Only say a comparison map is attached");
    expect(SYSTEM_PROMPT).toContain("comparison_map_generated=true");
    expect(SYSTEM_PROMPT).toContain("image was not generated");
    expect(SYSTEM_PROMPT).toContain("maps_generated_count is 0");
    expect(SYSTEM_PROMPT).toContain("attached_files is empty");
  });
});
