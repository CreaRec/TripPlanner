import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  getActiveTripId: vi.fn(),
  recentMessages: vi.fn(),
  saveMessage: vi.fn(),
  savePendingDestructiveAction: vi.fn(),
  getPendingDestructiveAction: vi.fn(),
  clearPendingDestructiveAction: vi.fn(),
  getTrip: vi.fn(),
  getItinerary: vi.fn(),
  searchMemories: vi.fn(),
  listReservations: vi.fn(),
  listSavedPlaces: vi.fn(),
  extractMemories: vi.fn(),
  createTripHandler: vi.fn(),
  saveInterestingPlaceHandler: vi.fn(),
  deletePlaceHandler: vi.fn(),
  disconnectGmailAccountHandler: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("../openai/client", () => ({
  openai: { chat: { completions: { create: h.createMock } } },
}));
vi.mock("../services/platform/users", () => ({ getActiveTripId: h.getActiveTripId }));
vi.mock("../services/platform/messages", () => ({
  recentMessages: h.recentMessages,
  saveMessage: h.saveMessage,
  savePendingDestructiveAction: h.savePendingDestructiveAction,
  getPendingDestructiveAction: h.getPendingDestructiveAction,
  clearPendingDestructiveAction: h.clearPendingDestructiveAction,
}));
vi.mock("../services/trip/trips", () => ({ getTrip: h.getTrip }));
vi.mock("../services/trip/itinerary", () => ({ getItinerary: h.getItinerary }));
vi.mock("../services/trip/memories", () => ({ searchMemories: h.searchMemories }));
vi.mock("../services/reservations/reservations", () => ({ listReservations: h.listReservations }));
vi.mock("../services/places/savedPlaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/places/savedPlaces")>();
  return {
    ...actual,
    listSavedPlaces: h.listSavedPlaces,
  };
});
vi.mock("../services/gmail/gmailAccounts", () => ({
  listAccounts: h.listAccounts,
  formatGmailContextLine: (accounts: unknown[]) =>
    accounts.length === 0 ? "Gmail: not connected." : "Gmail: connected.",
}));
vi.mock("./memory", () => ({ extractMemories: h.extractMemories }));
vi.mock("./tools", () => ({
  toolDefinitions: [],
  toolHandlers: {
    create_trip: h.createTripHandler,
    save_interesting_place: h.saveInterestingPlaceHandler,
    delete_place: h.deletePlaceHandler,
    disconnect_gmail_account: h.disconnectGmailAccountHandler,
  },
}));

import { runAgent } from "./runAgent";

beforeEach(() => {
  vi.clearAllMocks();
  // extractMemories is fire-and-forget; runAgent calls .catch() on the result.
  h.extractMemories.mockResolvedValue(undefined);
  h.getPendingDestructiveAction.mockResolvedValue(null);
  h.listSavedPlaces.mockResolvedValue([]);
  h.listAccounts.mockResolvedValue([]);
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

  it("can save a general interesting place without creating a trip", async () => {
    h.getActiveTripId.mockResolvedValueOnce(null);
    h.recentMessages.mockResolvedValueOnce([]);
    h.saveInterestingPlaceHandler.mockResolvedValueOnce({ ok: true, saved_place_id: 77 });
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "save_interesting_place",
                    arguments: '{"query":"Crater Lake","source_note":"future road trip"}',
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("Запомнил Crater Lake."));

    const result = await runAgent(111, "запомни Crater Lake в общие интересные места");

    expect(h.createTripHandler).not.toHaveBeenCalled();
    expect(h.saveInterestingPlaceHandler).toHaveBeenCalledWith(expect.anything(), {
      query: "Crater Lake",
      source_note: "future road trip",
    });
    expect(result.reply).toBe("Запомнил Crater Lake.");
  });

  it("reports tool errors back to the model without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("[agent] tool call failed");
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("create_trip");
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("boom");
    consoleError.mockRestore();
  });

  it("requires a separate confirmation turn before destructive tools run", async () => {
    h.getActiveTripId.mockResolvedValueOnce(7);
    h.getTrip.mockResolvedValueOnce({ id: 7, title: "Seattle" });
    h.searchMemories.mockResolvedValueOnce([]);
    h.getItinerary.mockResolvedValueOnce([]);
    h.listReservations.mockResolvedValueOnce([]);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "delete_place", arguments: '{"place_id":5,"confirmed":true}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("Подтвердите удаление этого места."));

    const result = await runAgent(111, "удали этот музей");

    expect(h.deletePlaceHandler).not.toHaveBeenCalled();
    expect(h.savePendingDestructiveAction).toHaveBeenCalledWith(111, 7, {
      toolName: "delete_place",
      args: { place_id: 5 },
    });
    expect(result.reply).toBe("Подтвердите удаление этого места.");
  });

  it("requires confirmation before disconnect_gmail_account runs", async () => {
    h.getActiveTripId.mockResolvedValueOnce(null);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "disconnect_gmail_account",
                    arguments: '{"google_email":"work@gmail.com","confirmed":true}',
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("Отключить work@gmail.com?"));

    const result = await runAgent(111, "отключи work@gmail.com");

    expect(h.disconnectGmailAccountHandler).not.toHaveBeenCalled();
    expect(h.savePendingDestructiveAction).toHaveBeenCalledWith(111, null, {
      toolName: "disconnect_gmail_account",
      args: { google_email: "work@gmail.com" },
    });
    expect(result.reply).toBe("Отключить work@gmail.com?");
  });

  it("runs a destructive tool only after matching pending confirmation", async () => {
    h.getActiveTripId.mockResolvedValueOnce(7);
    h.getPendingDestructiveAction.mockResolvedValueOnce({
      toolName: "delete_place",
      args: { place_id: 5 },
    });
    h.getTrip.mockResolvedValueOnce({ id: 7, title: "Seattle" });
    h.searchMemories.mockResolvedValueOnce([]);
    h.getItinerary.mockResolvedValueOnce([]);
    h.listReservations.mockResolvedValueOnce([]);
    h.recentMessages.mockResolvedValueOnce([]);
    h.deletePlaceHandler.mockResolvedValueOnce({ ok: true });
    h.createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "delete_place", arguments: '{"place_id":5}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistant("Удалил."));

    const result = await runAgent(111, "да");

    expect(h.deletePlaceHandler).toHaveBeenCalledWith(expect.anything(), {
      place_id: 5,
      confirmed: true,
    });
    expect(h.clearPendingDestructiveAction).toHaveBeenCalledWith(111, 7);
    expect(result.reply).toBe("Удалил.");
  });

  it("cancels a pending destructive action without calling the model", async () => {
    h.getActiveTripId.mockResolvedValueOnce(7);
    h.getPendingDestructiveAction.mockResolvedValueOnce({
      toolName: "delete_place",
      args: { place_id: 5 },
    });

    const result = await runAgent(111, "нет");

    expect(h.createMock).not.toHaveBeenCalled();
    expect(h.clearPendingDestructiveAction).toHaveBeenCalledWith(111, 7);
    expect(result.reply).toBe("Ок, не удаляю.");
  });

  it("clears stale pending deletion when the next message is unrelated", async () => {
    h.getActiveTripId.mockResolvedValueOnce(7);
    h.getPendingDestructiveAction.mockResolvedValueOnce({
      toolName: "delete_place",
      args: { place_id: 5 },
    });
    h.getTrip.mockResolvedValueOnce({ id: 7, title: "Seattle" });
    h.searchMemories.mockResolvedValueOnce([]);
    h.getItinerary.mockResolvedValueOnce([]);
    h.listReservations.mockResolvedValueOnce([]);
    h.recentMessages.mockResolvedValueOnce([]);
    h.createMock.mockResolvedValueOnce(assistant("Конечно, расскажу про план."));

    const result = await runAgent(111, "что у нас запланировано на 18 июля?");

    expect(h.clearPendingDestructiveAction).toHaveBeenCalledWith(111, 7);
    expect(h.deletePlaceHandler).not.toHaveBeenCalled();
    expect(result.reply).toBe("Конечно, расскажу про план.");

    const messages = h.createMock.mock.calls[0][0].messages;
    expect(messages[1].content).not.toContain("Pending destructive action");
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
