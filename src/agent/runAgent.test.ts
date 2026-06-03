import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  getActiveTripId: vi.fn(),
  recentMessages: vi.fn(),
  saveMessage: vi.fn(),
  getTrip: vi.fn(),
  getItinerary: vi.fn(),
  searchMemories: vi.fn(),
  listReservations: vi.fn(),
  extractMemories: vi.fn(),
  createTripHandler: vi.fn(),
}));

vi.mock("../openai/client", () => ({
  openai: { chat: { completions: { create: h.createMock } } },
}));
vi.mock("../services/users", () => ({ getActiveTripId: h.getActiveTripId }));
vi.mock("../services/messages", () => ({ recentMessages: h.recentMessages, saveMessage: h.saveMessage }));
vi.mock("../services/trips", () => ({ getTrip: h.getTrip }));
vi.mock("../services/itinerary", () => ({ getItinerary: h.getItinerary }));
vi.mock("../services/memories", () => ({ searchMemories: h.searchMemories }));
vi.mock("../services/reservations", () => ({ listReservations: h.listReservations }));
vi.mock("./memory", () => ({ extractMemories: h.extractMemories }));
vi.mock("./tools", () => ({
  toolDefinitions: [],
  toolHandlers: { create_trip: h.createTripHandler },
}));

import { runAgent } from "./runAgent";

beforeEach(() => {
  // extractMemories is fire-and-forget; runAgent calls .catch() on the result.
  h.extractMemories.mockResolvedValue(undefined);
});

function assistant(content: string) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

describe("runAgent", () => {
  it("returns the model reply and persists both messages", async () => {
    h.getActiveTripId.mockResolvedValueOnce(null);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createMock.mockResolvedValueOnce(assistant("Hello there!"));

    const result = await runAgent(111, "hi");

    expect(result.reply).toBe("Hello there!");
    expect(result.files).toEqual([]);
    expect(h.saveMessage).toHaveBeenCalledWith(111, null, "user", "hi");
    expect(h.saveMessage).toHaveBeenCalledWith(111, null, "assistant", "Hello there!");
    expect(h.extractMemories).toHaveBeenCalled();
  });

  it("executes tool calls then returns the final reply with generated files", async () => {
    h.getActiveTripId.mockResolvedValueOnce(null);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createTripHandler.mockImplementationOnce(async (ctx) => {
      ctx.activeTripId = 1;
      ctx.exports.push("/tmp/plan.pdf");
      return { ok: true };
    });
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "create_trip", arguments: '{"title":"Alps"}' } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("All set!"));

    const result = await runAgent(111, "plan a trip to the Alps");

    expect(h.createTripHandler).toHaveBeenCalledWith(expect.anything(), { title: "Alps" });
    expect(result.reply).toBe("All set!");
    expect(result.files).toEqual(["/tmp/plan.pdf"]);
  });

  it("reports tool errors back to the model without throwing", async () => {
    h.getActiveTripId.mockResolvedValueOnce(null);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createTripHandler.mockRejectedValueOnce(new Error("boom"));
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "create_trip", arguments: "{}" } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("Sorry, that failed."));

    const result = await runAgent(111, "go");
    expect(result.reply).toBe("Sorry, that failed.");
  });

  it("includes current reservations in the active trip context", async () => {
    h.getActiveTripId.mockResolvedValueOnce(7);
    h.getTrip.mockResolvedValueOnce({ id: 7, title: "Alps" });
    h.searchMemories.mockResolvedValueOnce([]);
    h.getItinerary.mockResolvedValueOnce([]);
    h.listReservations.mockResolvedValueOnce([
      {
        type: "hotel",
        title: "Hotel",
        provider: "Booking",
        confirmationNumber: "ABC123",
        startAt: new Date("2026-07-01T15:00:00Z"),
        endAt: null,
      },
    ]);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createMock.mockResolvedValueOnce(assistant("Saved."));

    await runAgent(111, "what is booked?");

    const messages = h.createMock.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("Current reservations:");
    expect(messages[1].content).toContain("[hotel] 2026-07-01T15:00Z: Hotel via Booking (confirmation: ABC123)");
  });
});
