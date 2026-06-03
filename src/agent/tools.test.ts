import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createTrip: vi.fn(),
  getTrip: vi.fn(),
  listTrips: vi.fn(),
  updateTrip: vi.fn(),
  addPlace: vi.fn(),
  listPlaces: vi.fn(),
  addItem: vi.fn(),
  clearDay: vi.fn(),
  getItinerary: vi.fn(),
  upsertDay: vi.fn(),
  saveMemory: vi.fn(),
  searchMemories: vi.fn(),
  exportItineraryCsv: vi.fn(),
  exportItineraryPdf: vi.fn(),
  setActiveTripId: vi.fn(),
}));

vi.mock("../services/trips", () => ({
  createTrip: m.createTrip,
  getTrip: m.getTrip,
  listTrips: m.listTrips,
  updateTrip: m.updateTrip,
}));
vi.mock("../services/places", () => ({ addPlace: m.addPlace, listPlaces: m.listPlaces }));
vi.mock("../services/itinerary", () => ({
  addItem: m.addItem,
  clearDay: m.clearDay,
  getItinerary: m.getItinerary,
  upsertDay: m.upsertDay,
}));
vi.mock("../services/memories", () => ({ saveMemory: m.saveMemory, searchMemories: m.searchMemories }));
vi.mock("../services/export", () => ({
  exportItineraryCsv: m.exportItineraryCsv,
  exportItineraryPdf: m.exportItineraryPdf,
}));
vi.mock("../services/users", () => ({ setActiveTripId: m.setActiveTripId }));

import { AgentContext, toolDefinitions, toolHandlers } from "./tools";

function ctx(activeTripId: number | null = null): AgentContext {
  return { telegramId: 111, activeTripId, exports: [] };
}

describe("toolDefinitions", () => {
  it("exposes the expected tool names", () => {
    const names = toolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_trip",
        "list_trips",
        "select_trip",
        "update_trip",
        "add_place",
        "list_places",
        "set_day",
        "add_itinerary_item",
        "clear_day",
        "get_itinerary",
        "save_memory",
        "search_memory",
        "export_itinerary",
      ]),
    );
  });
});

describe("create_trip", () => {
  it("creates the trip and makes it active", async () => {
    m.createTrip.mockResolvedValueOnce({ id: 42, title: "Alps" });
    const c = ctx(null);
    const result = await toolHandlers.create_trip(c, { title: "Alps" });
    expect(c.activeTripId).toBe(42);
    expect(m.setActiveTripId).toHaveBeenCalledWith(111, 42);
    expect(result).toMatchObject({ ok: true, trip_id: 42, active: true });
  });
});

describe("requireTrip-guarded tools", () => {
  it("add_place throws when there is no active trip", async () => {
    await expect(toolHandlers.add_place(ctx(null), { name: "x" })).rejects.toThrow(/No active trip/);
  });

  it("add_place works with an active trip", async () => {
    m.addPlace.mockResolvedValueOnce({ id: 5, name: "Lake" });
    const result = await toolHandlers.add_place(ctx(7), { name: "Lake", kid_friendly: true });
    expect(m.addPlace).toHaveBeenCalledWith(expect.objectContaining({ tripId: 7, name: "Lake", kidFriendly: true }));
    expect(result).toMatchObject({ ok: true, place_id: 5 });
  });
});

describe("select_trip", () => {
  it("throws when the trip does not exist", async () => {
    m.getTrip.mockResolvedValueOnce(null);
    await expect(toolHandlers.select_trip(ctx(), { trip_id: 99 })).rejects.toThrow(/not found/);
  });
});

describe("export_itinerary", () => {
  it("generates a PDF and records the file on the context", async () => {
    m.getTrip.mockResolvedValueOnce({ id: 7, title: "Alps" });
    m.exportItineraryPdf.mockResolvedValueOnce("/tmp/alps-7.pdf");
    const c = ctx(7);
    const result = await toolHandlers.export_itinerary(c, { format: "pdf" });
    expect(c.exports).toEqual(["/tmp/alps-7.pdf"]);
    expect(result).toMatchObject({ ok: true, format: "pdf" });
  });

  it("uses CSV when requested", async () => {
    m.getTrip.mockResolvedValueOnce({ id: 7, title: "Alps" });
    m.exportItineraryCsv.mockResolvedValueOnce("/tmp/alps-7.csv");
    const c = ctx(7);
    await toolHandlers.export_itinerary(c, { format: "csv" });
    expect(m.exportItineraryCsv).toHaveBeenCalled();
    expect(c.exports[0]).toContain(".csv");
  });
});

describe("save_memory", () => {
  it("scopes to the active trip by default and globally when asked", async () => {
    m.saveMemory.mockResolvedValue({ id: 1 });
    await toolHandlers.save_memory(ctx(7), { content: "likes hikes" });
    expect(m.saveMemory).toHaveBeenCalledWith(expect.objectContaining({ tripId: 7 }));

    await toolHandlers.save_memory(ctx(7), { content: "vegetarian", global: true });
    expect(m.saveMemory).toHaveBeenLastCalledWith(expect.objectContaining({ tripId: null }));
  });
});
