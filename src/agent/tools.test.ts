import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createTrip: vi.fn(),
  deleteTrip: vi.fn(),
  getTrip: vi.fn(),
  listTrips: vi.fn(),
  updateTrip: vi.fn(),
  addPlace: vi.fn(),
  deletePlace: vi.fn(),
  listPlaces: vi.fn(),
  updatePlace: vi.fn(),
  addItem: vi.fn(),
  clearDay: vi.fn(),
  deleteDay: vi.fn(),
  deleteItem: vi.fn(),
  getItinerary: vi.fn(),
  updateItem: vi.fn(),
  upsertDay: vi.fn(),
  deleteMemory: vi.fn(),
  replaceMemory: vi.fn(),
  saveMemory: vi.fn(),
  searchMemories: vi.fn(),
  addReservation: vi.fn(),
  deleteReservation: vi.fn(),
  listReservations: vi.fn(),
  updateReservation: vi.fn(),
  exportItineraryCsv: vi.fn(),
  exportItineraryPdf: vi.fn(),
  searchPlaceDetails: vi.fn(),
  enrichPlace: vi.fn(),
  setActiveTripId: vi.fn(),
}));

vi.mock("../services/trips", () => ({
  createTrip: m.createTrip,
  deleteTrip: m.deleteTrip,
  getTrip: m.getTrip,
  listTrips: m.listTrips,
  updateTrip: m.updateTrip,
}));
vi.mock("../services/places", () => ({
  PLACE_CATEGORIES: [
    "restaurant",
    "museum",
    "natural_attraction",
    "national_park",
    "tour",
    "other",
  ],
  addPlace: m.addPlace,
  deletePlace: m.deletePlace,
  listPlaces: m.listPlaces,
  updatePlace: m.updatePlace,
}));
vi.mock("../services/itinerary", () => ({
  addItem: m.addItem,
  clearDay: m.clearDay,
  deleteDay: m.deleteDay,
  deleteItem: m.deleteItem,
  getItinerary: m.getItinerary,
  updateItem: m.updateItem,
  upsertDay: m.upsertDay,
}));
vi.mock("../services/memories", () => ({
  deleteMemory: m.deleteMemory,
  replaceMemory: m.replaceMemory,
  saveMemory: m.saveMemory,
  searchMemories: m.searchMemories,
}));
vi.mock("../services/reservations", () => ({
  addReservation: m.addReservation,
  deleteReservation: m.deleteReservation,
  listReservations: m.listReservations,
  updateReservation: m.updateReservation,
}));
vi.mock("../services/export", () => ({
  exportItineraryCsv: m.exportItineraryCsv,
  exportItineraryPdf: m.exportItineraryPdf,
}));
vi.mock("../services/placeEnrichment", () => ({
  searchPlaceDetails: m.searchPlaceDetails,
  enrichPlace: m.enrichPlace,
}));
vi.mock("../services/users", () => ({ setActiveTripId: m.setActiveTripId }));

import { AgentContext, toolDefinitions, toolHandlers } from "./tools";

function ctx(activeTripId: number | null = null): AgentContext {
  return { telegramId: 111, activeTripId, exports: [] };
}

function toolFunction(name: string) {
  const tool = toolDefinitions.find((t) => t.type === "function" && t.function.name === name);
  if (!tool || tool.type !== "function") throw new Error(`Tool ${name} not found.`);
  return tool.function;
}

describe("toolDefinitions", () => {
  it("exposes the expected tool names", () => {
    const names = toolDefinitions.flatMap((t) => (t.type === "function" ? [t.function.name] : []));
    expect(names).toEqual(
      expect.arrayContaining([
        "create_trip",
        "list_trips",
        "select_trip",
        "update_trip",
        "delete_trip",
        "add_place",
        "list_places",
        "search_place_details",
        "enrich_place",
        "update_place",
        "delete_place",
        "add_reservation",
        "list_reservations",
        "update_reservation",
        "delete_reservation",
        "set_day",
        "add_itinerary_item",
        "update_itinerary_item",
        "delete_itinerary_item",
        "clear_day",
        "delete_day",
        "get_itinerary",
        "save_memory",
        "search_memory",
        "replace_memory",
        "delete_memory",
        "export_itinerary",
      ]),
    );
  });

  it("restricts place categories to the supported values", () => {
    const expectedCategories = [
      "restaurant",
      "museum",
      "natural_attraction",
      "national_park",
      "tour",
      "other",
    ];
    const addPlace = toolFunction("add_place");
    const updatePlace = toolFunction("update_place");

    expect((addPlace.parameters as any).properties.category.enum).toEqual(expectedCategories);
    expect((updatePlace.parameters as any).properties.category.enum).toEqual(expectedCategories);
  });

  it("instructs the agent to pass search results into enrich_place for existing places", () => {
    const searchPlace = toolFunction("search_place_details");
    const enrichPlace = toolFunction("enrich_place");

    expect(searchPlace.description).toContain("pass the selected external_id to enrich_place");
    expect(enrichPlace.description).toContain("existing place_id");
    expect(enrichPlace.description).toContain("external_id");
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

  it("delete_trip requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_trip(ctx(42), {})).rejects.toThrow(/confirmation/);
  });

  it("delete_trip clears the active trip when deleting it", async () => {
    m.deleteTrip.mockResolvedValueOnce(true);
    const c = ctx(42);
    const result = await toolHandlers.delete_trip(c, { confirmed: true });
    expect(m.deleteTrip).toHaveBeenCalledWith(111, 42);
    expect(m.setActiveTripId).toHaveBeenLastCalledWith(111, null);
    expect(c.activeTripId).toBeNull();
    expect(result).toEqual({ ok: true });
  });
});

describe("requireTrip-guarded tools", () => {
  it("add_place throws when there is no active trip", async () => {
    await expect(toolHandlers.add_place(ctx(null), { name: "x" })).rejects.toThrow(/No active trip/);
  });

  it("add_place works with an active trip", async () => {
    m.addPlace.mockResolvedValueOnce({ id: 5, name: "Lake" });
    const result = await toolHandlers.add_place(ctx(7), {
      name: "Lake",
      category: "natural_attraction",
      kid_friendly: true,
    });
    expect(m.addPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 7,
        name: "Lake",
        category: "natural_attraction",
        kidFriendly: true,
      }),
    );
    expect(result).toMatchObject({ ok: true, place_id: 5 });
  });

  it("add_place rejects unsupported categories", async () => {
    m.addPlace.mockClear();
    await expect(toolHandlers.add_place(ctx(7), { name: "Lake", category: "shopping" })).rejects.toThrow(
      /category must be one of/,
    );
    expect(m.addPlace).not.toHaveBeenCalled();
  });

  it("add_place normalizes a null category to other", async () => {
    m.addPlace.mockResolvedValueOnce({ id: 6, name: "Stop" });
    await toolHandlers.add_place(ctx(7), { name: "Stop", category: null });
    expect(m.addPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 7,
        name: "Stop",
        category: "other",
      }),
    );
  });

  it("add_reservation throws when there is no active trip", async () => {
    await expect(toolHandlers.add_reservation(ctx(null), { type: "hotel", title: "Hotel" })).rejects.toThrow(
      /No active trip/,
    );
  });

  it("add_reservation saves booking details for the active trip", async () => {
    m.addReservation.mockResolvedValueOnce({ id: 9, title: "Hotel" });
    const result = await toolHandlers.add_reservation(ctx(7), {
      type: "hotel",
      title: "Hotel",
      confirmation_number: "ABC123",
      metadata: { room: "suite" },
    });
    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 7,
        type: "hotel",
        title: "Hotel",
        confirmationNumber: "ABC123",
        metadata: { room: "suite" },
      }),
    );
    expect(result).toMatchObject({ ok: true, reservation_id: 9 });
  });

  it("list_reservations returns saved bookings for the active trip", async () => {
    m.listReservations.mockResolvedValueOnce([
      {
        id: 9,
        type: "hotel",
        title: "Hotel",
        provider: "Provider",
        confirmationNumber: "ABC123",
        startAt: new Date("2026-07-01T15:00:00Z"),
        endAt: null,
        address: "1 Main St",
        status: "booked",
        notes: null,
      },
    ]);
    const result = await toolHandlers.list_reservations(ctx(7), {});
    expect(m.listReservations).toHaveBeenCalledWith(7);
    expect(result).toEqual([
      expect.objectContaining({
        id: 9,
        type: "hotel",
        confirmation_number: "ABC123",
        start_at: "2026-07-01T15:00:00.000Z",
      }),
    ]);
  });

  it("list_places returns enrichment fields", async () => {
    m.listPlaces.mockResolvedValueOnce([
      {
        id: 5,
        name: "Louvre",
        category: "museum",
        address: "Rue de Rivoli",
        latitude: 48.8606,
        longitude: 2.3376,
        websiteUrl: "https://www.louvre.fr",
        mapsUrl: "https://maps.google.com/?cid=abc",
        phone: "01 40 20 50 50",
        bookingUrl: null,
        ticketUrl: "https://www.louvre.fr",
        reservationRecommended: true,
        rating: 4.7,
        priceLevel: 2,
        priority: 1,
        durationMin: 180,
        kidFriendly: true,
        notes: "Book ahead",
      },
    ]);
    const result = await toolHandlers.list_places(ctx(7), {});
    expect(m.listPlaces).toHaveBeenCalledWith(7);
    expect(result).toEqual([
      expect.objectContaining({
        id: 5,
        website_url: "https://www.louvre.fr",
        maps_url: "https://maps.google.com/?cid=abc",
        ticket_url: "https://www.louvre.fr",
        reservation_recommended: true,
        rating: 4.7,
      }),
    ]);
  });

  it("search_place_details searches in the active trip destination", async () => {
    m.getTrip.mockResolvedValueOnce({ id: 7, destination: "Paris" });
    m.searchPlaceDetails.mockResolvedValueOnce([
      {
        provider: "google_places",
        externalId: "abc",
        name: "Louvre Museum",
        category: "museum",
        address: "Rue de Rivoli",
        latitude: 48.8606,
        longitude: 2.3376,
        mapsUrl: "https://maps.google.com/?cid=abc",
        types: ["museum"],
      },
    ]);
    const result = await toolHandlers.search_place_details(ctx(7), { query: "Louvre", max_results: 2 });
    expect(m.searchPlaceDetails).toHaveBeenCalledWith({
      query: "Louvre",
      destination: "Paris",
      maxResults: 2,
    });
    expect(result).toEqual([
      expect.objectContaining({
        external_provider: "google_places",
        external_id: "abc",
        category: "museum",
      }),
    ]);
  });

  it("enrich_place enriches an existing saved place", async () => {
    m.getTrip.mockResolvedValueOnce({ id: 7, destination: "Paris" });
    m.enrichPlace.mockResolvedValueOnce({
      updated: true,
      duplicatePlaceId: null,
      place: { id: 5 },
      googlePlace: {
        externalId: "abc",
        name: "Louvre Museum",
        category: "museum",
        address: "Rue de Rivoli",
        websiteUrl: "https://www.louvre.fr",
        mapsUrl: "https://maps.google.com/?cid=abc",
        phone: "01 40 20 50 50",
        bookingUrl: null,
        ticketUrl: "https://www.louvre.fr",
        reservationRecommended: true,
        advice: "Check tickets.",
      },
    });
    const result = await toolHandlers.enrich_place(ctx(7), { place_id: 5, external_id: "abc" });
    expect(m.enrichPlace).toHaveBeenCalledWith({
      tripId: 7,
      placeId: 5,
      destination: "Paris",
      query: null,
      externalId: "abc",
    });
    expect(result).toMatchObject({
      ok: true,
      place_id: 5,
      google_place: { ticket_url: "https://www.louvre.fr", reservation_recommended: true },
    });
  });

  it("update_reservation updates a booking in the active trip", async () => {
    m.updateReservation.mockResolvedValueOnce({ id: 9, title: "Updated" });
    const result = await toolHandlers.update_reservation(ctx(7), {
      reservation_id: 9,
      title: "Updated",
      confirmation_number: "XYZ789",
    });
    expect(m.updateReservation).toHaveBeenCalledWith(
      7,
      9,
      expect.objectContaining({ title: "Updated", confirmationNumber: "XYZ789" }),
    );
    expect(result).toMatchObject({ ok: true, reservation_id: 9 });
  });

  it("delete_reservation requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_reservation(ctx(7), { reservation_id: 9 })).rejects.toThrow(/confirmation/);
  });

  it("delete_reservation deletes a confirmed booking in the active trip", async () => {
    m.deleteReservation.mockResolvedValueOnce(true);
    const result = await toolHandlers.delete_reservation(ctx(7), { reservation_id: 9, confirmed: true });
    expect(m.deleteReservation).toHaveBeenCalledWith(7, 9);
    expect(result).toEqual({ ok: true });
  });

  it("update_place updates a saved place in the active trip", async () => {
    m.updatePlace.mockResolvedValueOnce({ id: 5, name: "Lake" });
    const result = await toolHandlers.update_place(ctx(7), {
      place_id: 5,
      category: "national_park",
      notes: "Go early",
    });
    expect(m.updatePlace).toHaveBeenCalledWith(7, 5, {
      category: "national_park",
      notes: "Go early",
    });
    expect(result).toMatchObject({ ok: true, place_id: 5 });
  });

  it("update_place normalizes a null category to other", async () => {
    m.updatePlace.mockResolvedValueOnce({ id: 5, name: "Lake" });
    const result = await toolHandlers.update_place(ctx(7), {
      place_id: 5,
      category: null,
    });
    expect(m.updatePlace).toHaveBeenCalledWith(7, 5, { category: "other" });
    expect(result).toMatchObject({ ok: true, place_id: 5 });
  });

  it("delete_place requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_place(ctx(7), { place_id: 5 })).rejects.toThrow(/confirmation/);
  });

  it("update_itinerary_item updates an item in the active trip", async () => {
    m.updateItem.mockResolvedValueOnce({ id: 22, title: "Museum" });
    const result = await toolHandlers.update_itinerary_item(ctx(7), {
      item_id: 22,
      title: "Museum",
      is_backup: true,
    });
    expect(m.updateItem).toHaveBeenCalledWith(7, 22, { title: "Museum", isBackup: true });
    expect(result).toMatchObject({ ok: true, item_id: 22 });
  });

  it("delete_itinerary_item requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_itinerary_item(ctx(7), { item_id: 22 })).rejects.toThrow(/confirmation/);
  });

  it("clear_day requires explicit confirmation", async () => {
    await expect(toolHandlers.clear_day(ctx(7), { day_number: 2 })).rejects.toThrow(/confirmation/);
  });

  it("clear_day clears a confirmed day in the active trip", async () => {
    const result = await toolHandlers.clear_day(ctx(7), { day_number: 2, confirmed: true });
    expect(m.clearDay).toHaveBeenCalledWith(7, 2);
    expect(result).toEqual({ ok: true });
  });

  it("delete_day deletes a confirmed day in the active trip", async () => {
    m.deleteDay.mockResolvedValueOnce(true);
    const result = await toolHandlers.delete_day(ctx(7), { day_number: 2, confirmed: true });
    expect(m.deleteDay).toHaveBeenCalledWith(7, 2);
    expect(result).toEqual({ ok: true });
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

  it("replace_memory replaces a scoped memory", async () => {
    m.replaceMemory.mockResolvedValueOnce({ id: 2, content: "likes museums" });
    const result = await toolHandlers.replace_memory(ctx(7), {
      memory_id: 1,
      content: "likes museums",
      kind: "preference",
    });
    expect(m.replaceMemory).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: 111, memoryId: 1, tripId: 7, content: "likes museums" }),
    );
    expect(result).toMatchObject({ ok: true, memory_id: 2 });
  });

  it("delete_memory requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_memory(ctx(7), { memory_id: 1 })).rejects.toThrow(/confirmation/);
  });

  it("delete_memory deletes a confirmed scoped memory", async () => {
    m.deleteMemory.mockResolvedValueOnce(true);
    const result = await toolHandlers.delete_memory(ctx(7), { memory_id: 1, confirmed: true });
    expect(m.deleteMemory).toHaveBeenCalledWith(111, 1, 7);
    expect(result).toEqual({ ok: true });
  });
});
