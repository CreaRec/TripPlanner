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
  deleteSavedPlace: vi.fn(),
  listSavedPlaces: vi.fn(),
  saveInterestingPlace: vi.fn(),
  updateSavedPlace: vi.fn(),
  suggestSavedPlacesOnRoute: vi.fn(),
  generateRouteComparisonMap: vi.fn(),
  isStaticMapsConfigured: vi.fn(),
  getWeather: vi.fn(),
  isWeatherConfigured: vi.fn(),
  setActiveTripId: vi.fn(),
  listAccounts: vi.fn(),
  getAccountByEmail: vi.fn(),
  getAccountById: vi.fn(),
  disconnectAccount: vi.fn(),
  buildGmailSearchQuery: vi.fn(),
  searchGmailAccounts: vi.fn(),
  saveGmailSearchSession: vi.fn(),
  exportGmailMessageToEml: vi.fn(),
  getPlace: vi.fn(),
  isGmailOAuthConfigured: vi.fn(),
  startConnectFlow: vi.fn(),
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
  getPlace: m.getPlace,
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
vi.mock("../services/savedPlaces", () => ({
  SAVED_PLACE_STATUSES: ["want_to_visit", "visited", "archived"],
  deleteSavedPlace: m.deleteSavedPlace,
  listSavedPlaces: m.listSavedPlaces,
  saveInterestingPlace: m.saveInterestingPlace,
  updateSavedPlace: m.updateSavedPlace,
}));
vi.mock("../services/googleRoutes", () => ({
  suggestSavedPlacesOnRoute: m.suggestSavedPlacesOnRoute,
}));
vi.mock("../services/staticMaps", () => ({
  generateRouteComparisonMap: m.generateRouteComparisonMap,
  isStaticMapsConfigured: m.isStaticMapsConfigured,
}));
vi.mock("../services/weather", () => ({
  getWeather: m.getWeather,
  isWeatherConfigured: m.isWeatherConfigured,
}));
vi.mock("../services/users", () => ({ setActiveTripId: m.setActiveTripId }));
vi.mock("../services/gmailAccounts", () => ({
  listAccounts: m.listAccounts,
  getAccountByEmail: m.getAccountByEmail,
  getAccountById: m.getAccountById,
  disconnectAccount: m.disconnectAccount,
}));
vi.mock("../services/gmailSearchQuery", () => ({ buildGmailSearchQuery: m.buildGmailSearchQuery }));
vi.mock("../services/gmailSearch", () => ({ searchGmailAccounts: m.searchGmailAccounts }));
vi.mock("../services/gmailSearchSession", () => ({ saveGmailSearchSession: m.saveGmailSearchSession }));
vi.mock("../services/gmailExport", () => ({ exportGmailMessageToEml: m.exportGmailMessageToEml }));
vi.mock("../config", () => ({ isGmailOAuthConfigured: m.isGmailOAuthConfigured }));
vi.mock("../http/server", () => ({ startConnectFlow: m.startConnectFlow }));

import { AgentContext, toolDefinitions, toolHandlers } from "./tools";

function ctx(activeTripId: number | null = null): AgentContext {
  return { telegramId: 111, activeTripId, exports: [] };
}

function toolFunction(name: string) {
  const tool = toolDefinitions.find((t) => t.type === "function" && t.function.name === name);
  if (!tool || tool.type !== "function") throw new Error(`Tool ${name} not found.`);
  return tool.function;
}

function savedPlace(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    name: "Crater Lake",
    category: "national_park",
    status: "want_to_visit",
    address: "Oregon",
    latitude: 42.9446,
    longitude: -122.109,
    websiteUrl: "https://www.nps.gov/crla",
    mapsUrl: "https://maps.google.com/?cid=crater",
    phone: null,
    bookingUrl: null,
    ticketUrl: "https://www.nps.gov/crla",
    reservationRecommended: true,
    rating: 4.9,
    priceLevel: null,
    priority: 1,
    durationMin: 180,
    kidFriendly: true,
    sourceNote: "Road trip idea",
    notes: "Scenic stop",
    ...overrides,
  };
}

describe("toolDefinitions", () => {
  it("exposes the expected tool names", () => {
    const names = toolDefinitions.flatMap((t) => (t.type === "function" ? [t.function.name] : []));
    expect(names).toEqual(
      expect.arrayContaining([
        "create_trip",
        "list_trips",
        "select_trip",
        "clear_active_trip",
        "update_trip",
        "delete_trip",
        "add_place",
        "list_places",
        "search_place_details",
        "enrich_place",
        "update_place",
        "delete_place",
        "save_interesting_place",
        "list_interesting_places",
        "update_interesting_place",
        "delete_interesting_place",
        "suggest_saved_places_on_route",
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
        "search_gmail",
        "get_weather",
      ]),
    );
  });

  it("limits get_weather to explicit user weather requests", () => {
    const getWeather = toolFunction("get_weather");
    expect(getWeather.description).toContain("Only use when the user explicitly asks");
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

  it("restricts interesting place statuses to supported values", () => {
    const saveInterestingPlace = toolFunction("save_interesting_place");
    const updateInterestingPlace = toolFunction("update_interesting_place");

    expect((saveInterestingPlace.parameters as any).properties.status.enum).toEqual([
      "want_to_visit",
      "visited",
      "archived",
    ]);
    expect((updateInterestingPlace.parameters as any).properties.status.enum).toContain("visited");
  });

  it("instructs the agent to pass search results into enrich_place for existing places", () => {
    const searchPlace = toolFunction("search_place_details");
    const enrichPlace = toolFunction("enrich_place");

    expect(searchPlace.description).toContain("pass the selected external_id to enrich_place");
    expect(enrichPlace.description).toContain("existing place_id");
    expect(enrichPlace.description).toContain("external_id");
  });

  it("tells the agent not to guess route endpoints", () => {
    const suggestRoute = toolFunction("suggest_saved_places_on_route");

    expect(suggestRoute.description).toContain("both origin and destination");
    expect(suggestRoute.description).toContain("ask where they are starting from");
    expect((suggestRoute.parameters as any).properties.origin.description).toContain("Do not guess");
    expect((suggestRoute.parameters as any).properties.stop_query.description).toContain("specific place");
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

describe("general interesting places", () => {
  it("saves an interesting place without an active trip", async () => {
    const place = savedPlace();
    m.saveInterestingPlace.mockResolvedValueOnce({
      place,
      googlePlace: {
        externalId: "g-crater",
        name: "Crater Lake National Park",
        category: "national_park",
        address: "Oregon",
        websiteUrl: "https://www.nps.gov/crla",
        mapsUrl: "https://maps.google.com/?cid=crater",
        phone: null,
        bookingUrl: null,
        ticketUrl: "https://www.nps.gov/crla",
        reservationRecommended: true,
        advice: "Check permits.",
      },
      created: true,
    });

    const result = await toolHandlers.save_interesting_place(ctx(null), {
      query: "Crater Lake",
      source_note: "for a future Oregon road trip",
    });

    expect(m.saveInterestingPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 111,
        query: "Crater Lake",
        status: "want_to_visit",
        sourceNote: "for a future Oregon road trip",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      created: true,
      saved_place_id: 77,
      place: { name: "Crater Lake", maps_url: "https://maps.google.com/?cid=crater" },
    });
  });

  it("lists interesting places independently of the active trip", async () => {
    m.listSavedPlaces.mockResolvedValueOnce([savedPlace()]);

    const result = await toolHandlers.list_interesting_places(ctx(null), {
      status: "want_to_visit",
      with_coordinates_only: true,
      limit: 5,
    });

    expect(m.listSavedPlaces).toHaveBeenCalledWith(111, {
      status: "want_to_visit",
      category: undefined,
      withCoordinatesOnly: true,
      limit: 5,
    });
    expect(result).toEqual([expect.objectContaining({ id: 77, name: "Crater Lake" })]);
  });

  it("updates an interesting place", async () => {
    m.updateSavedPlace.mockResolvedValueOnce(savedPlace({ status: "visited" }));

    const result = await toolHandlers.update_interesting_place(ctx(null), {
      saved_place_id: 77,
      status: "visited",
      notes: "Went in June",
    });

    expect(m.updateSavedPlace).toHaveBeenCalledWith(
      111,
      77,
      expect.objectContaining({ status: "visited", notes: "Went in June" }),
    );
    expect(result).toMatchObject({ ok: true, saved_place_id: 77, place: { status: "visited" } });
  });

  it("delete_interesting_place requires explicit confirmation", async () => {
    await expect(toolHandlers.delete_interesting_place(ctx(null), { saved_place_id: 77 })).rejects.toThrow(
      /confirmation/,
    );
  });

  it("suggests saved places on a route with route limits", async () => {
    const place = savedPlace();
    m.listSavedPlaces.mockResolvedValueOnce([place]);
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([
      {
        place,
        distanceFromRouteMeters: 12_300,
        detourDurationSeconds: 900,
        detourDistanceMeters: 18_200,
        detourRatio: 0.04,
        routeDurationSeconds: 22_500,
        routeDistanceMeters: 410_000,
      },
    ]);

    const result = await toolHandlers.suggest_saved_places_on_route(ctx(null), {
      origin: "Portland, OR",
      destination: "San Francisco, CA",
      max_distance_from_route_km: 40,
      max_route_checks: 10,
      max_detour_min: 25,
    });

    expect(m.listSavedPlaces).toHaveBeenCalledWith(
      111,
      expect.objectContaining({ status: "want_to_visit", withCoordinatesOnly: true }),
    );
    expect(m.suggestSavedPlacesOnRoute).toHaveBeenCalledWith(
      "Portland, OR",
      "San Francisco, CA",
      [place],
      expect.objectContaining({
        maxDistanceFromRouteMeters: 40_000,
        maxRouteChecks: 10,
        maxDetourDurationSeconds: 1500,
        includeRejectedSuggestions: false,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        maps_requested: false,
        maps_generated_count: 0,
        suggestions: [
          expect.objectContaining({
            distance_from_route_km: 12.3,
            detour_min: 15,
            detour_km: 18.2,
          }),
        ],
      }),
    );
  });

  it("attaches comparison maps for top route suggestions when requested", async () => {
    const first = savedPlace({ id: 77, name: "Urban Hill" });
    const second = savedPlace({ id: 78, name: "Moki Dugway" });
    m.listSavedPlaces.mockResolvedValueOnce([first, second]);
    m.isStaticMapsConfigured.mockReturnValueOnce(true);
    m.generateRouteComparisonMap.mockResolvedValueOnce("/tmp/urban-hill.png");
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([
      {
        place: first,
        origin: "Austin, TX",
        destination: "Moab, UT",
        startLocation: { latitude: 30.2672, longitude: -97.7431 },
        stopLocation: { latitude: 40.7608, longitude: -111.891 },
        endLocation: { latitude: 38.5733, longitude: -109.5498 },
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "detour-polyline",
        distanceFromRouteMeters: 4_000,
        detourDurationSeconds: 240,
        detourDistanceMeters: 3_200,
        detourRatio: 0.01,
        withinDetourThreshold: true,
        routeDurationSeconds: 30_240,
        routeDistanceMeters: 1_003_200,
      },
      {
        place: second,
        origin: "Austin, TX",
        destination: "Moab, UT",
        startLocation: { latitude: 30.2672, longitude: -97.7431 },
        stopLocation: { latitude: 37.274, longitude: -109.942 },
        endLocation: { latitude: 38.5733, longitude: -109.5498 },
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "detour-polyline-2",
        distanceFromRouteMeters: 30_000,
        detourDurationSeconds: 1_200,
        detourDistanceMeters: 20_000,
        detourRatio: 0.04,
        withinDetourThreshold: true,
        routeDurationSeconds: 31_200,
        routeDistanceMeters: 1_020_000,
      },
    ]);

    const c = ctx(null);
    const result = await toolHandlers.suggest_saved_places_on_route(c, {
      origin: "Austin, TX",
      destination: "Moab, UT",
      include_maps: true,
      max_maps: 1,
    });

    expect(m.suggestSavedPlacesOnRoute).toHaveBeenCalledWith(
      "Austin, TX",
      "Moab, UT",
      [first, second],
      expect.objectContaining({ includeRejectedSuggestions: true }),
    );

    expect(m.generateRouteComparisonMap).toHaveBeenCalledTimes(1);
    expect(m.generateRouteComparisonMap).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "Austin, TX",
        destination: "Moab, UT",
        stopName: "Urban Hill",
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "detour-polyline",
      }),
    );
    expect(c.exports).toEqual(["/tmp/urban-hill.png"]);
    expect(result).toEqual(
      expect.objectContaining({
        maps_requested: true,
        maps_generated_count: 1,
        attached_files: ["/tmp/urban-hill.png"],
        instruction: "You may say the comparison map is attached.",
        suggestions: [
          expect.objectContaining({
            comparison_map_requested: true,
            comparison_map_generated: true,
            comparison_map_file: "/tmp/urban-hill.png",
          }),
          expect.objectContaining({
            comparison_map_requested: true,
            comparison_map_generated: false,
            comparison_map_file: null,
          }),
        ],
      }),
    );
  });

  it("uses an explicit stop query instead of saved-place candidates for route comparison maps", async () => {
    m.searchPlaceDetails.mockResolvedValueOnce([
      {
        provider: "google_places",
        externalId: "dallas",
        name: "Dallas",
        category: "other",
        address: "Dallas, TX, USA",
        latitude: 32.7767,
        longitude: -96.797,
        mapsUrl: "https://maps.google.com/?cid=dallas",
        types: ["locality"],
      },
    ]);
    m.isStaticMapsConfigured.mockReturnValueOnce(true);
    m.generateRouteComparisonMap.mockResolvedValueOnce("/tmp/dallas.png");
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([
      {
        place: savedPlace({
          id: -1,
          name: "Dallas",
          address: "Dallas, TX, USA",
          latitude: 32.7767,
          longitude: -96.797,
        }),
        origin: "Austin, TX",
        destination: "Houston, TX",
        startLocation: { latitude: 30.2672, longitude: -97.7431 },
        stopLocation: { latitude: 32.7767, longitude: -96.797 },
        endLocation: { latitude: 29.7604, longitude: -95.3698 },
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "dallas-detour-polyline",
        distanceFromRouteMeters: 250_000,
        detourDurationSeconds: 7_200,
        detourDistanceMeters: 300_000,
        detourRatio: 1.5,
        withinDetourThreshold: false,
        routeDurationSeconds: 12_000,
        routeDistanceMeters: 600_000,
      },
    ]);

    const c = ctx(null);
    const result = await toolHandlers.suggest_saved_places_on_route(c, {
      origin: "Austin, TX",
      destination: "Houston, TX",
      stop_query: "Dallas",
      include_maps: true,
      max_maps: 1,
    });

    expect(m.listSavedPlaces).not.toHaveBeenCalled();
    expect(m.searchPlaceDetails).toHaveBeenCalledWith({
      query: "Dallas",
      destination: null,
      maxResults: 1,
    });
    expect(m.suggestSavedPlacesOnRoute).toHaveBeenCalledWith(
      "Austin, TX",
      "Houston, TX",
      [
        expect.objectContaining({
          id: -1,
          name: "Dallas",
          latitude: 32.7767,
          longitude: -96.797,
        }),
      ],
      expect.objectContaining({
        maxDistanceFromRouteMeters: Number.POSITIVE_INFINITY,
        includeRejectedSuggestions: true,
      }),
    );
    expect(m.generateRouteComparisonMap).toHaveBeenCalledWith(
      expect.objectContaining({
        stopName: "Dallas",
        stopLocation: { latitude: 32.7767, longitude: -96.797 },
        detourEncodedPolyline: "dallas-detour-polyline",
      }),
    );
    expect(c.exports).toEqual(["/tmp/dallas.png"]);
    expect(result).toEqual(
      expect.objectContaining({
        maps_generated_count: 1,
        suggestions: [expect.objectContaining({ within_detour_threshold: false })],
      }),
    );
  });

  it("falls back to destination-biased stop search only when direct stop search has no result", async () => {
    m.searchPlaceDetails
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          provider: "google_places",
          externalId: "space-center",
          name: "Space Center Houston",
          category: "museum",
          address: "1601 E NASA Pkwy, Houston, TX",
          latitude: 29.5518,
          longitude: -95.0981,
          mapsUrl: "https://maps.google.com/?cid=space",
          types: ["museum"],
        },
      ]);
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([]);

    await toolHandlers.suggest_saved_places_on_route(ctx(null), {
      origin: "Austin, TX",
      destination: "Houston, TX",
      stop_query: "space center",
      include_maps: true,
    });

    expect(m.searchPlaceDetails).toHaveBeenNthCalledWith(1, {
      query: "space center",
      destination: null,
      maxResults: 1,
    });
    expect(m.searchPlaceDetails).toHaveBeenNthCalledWith(2, {
      query: "space center",
      destination: "Houston, TX",
      maxResults: 1,
    });
  });

  it("keeps route suggestions when comparison map generation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const place = savedPlace({ id: 77, name: "Urban Hill" });
    m.listSavedPlaces.mockResolvedValueOnce([place]);
    m.isStaticMapsConfigured.mockReturnValueOnce(true);
    m.generateRouteComparisonMap.mockRejectedValueOnce(new Error("Google Static Maps API request failed (413)"));
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([
      {
        place,
        origin: "Austin, TX",
        destination: "Moab, UT",
        startLocation: { latitude: 30.2672, longitude: -97.7431 },
        stopLocation: { latitude: 40.7608, longitude: -111.891 },
        endLocation: { latitude: 38.5733, longitude: -109.5498 },
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "detour-polyline",
        distanceFromRouteMeters: 4_000,
        detourDurationSeconds: 240,
        detourDistanceMeters: 3_200,
        detourRatio: 0.01,
        withinDetourThreshold: false,
        routeDurationSeconds: 30_240,
        routeDistanceMeters: 1_003_200,
      },
    ]);

    const c = ctx(null);
    const result = await toolHandlers.suggest_saved_places_on_route(c, {
      origin: "Austin, TX",
      destination: "Moab, UT",
      include_maps: true,
    });

    expect(c.exports).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        maps_requested: true,
        maps_generated_count: 0,
        attached_files: [],
        instruction: expect.stringContaining("Do not say a comparison map is attached"),
        suggestions: [
          expect.objectContaining({
            place: expect.objectContaining({ name: "Urban Hill" }),
            comparison_map_requested: true,
            comparison_map_generated: false,
            comparison_map_file: null,
            comparison_map_error: "Google Static Maps API request failed (413)",
            within_detour_threshold: false,
          }),
        ],
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[static-maps] route comparison map failed",
      expect.objectContaining({ placeId: 77 }),
    );
    consoleError.mockRestore();
  });

  it("reports when maps are requested but Static Maps is not configured", async () => {
    const place = savedPlace({ id: 77, name: "Urban Hill" });
    m.listSavedPlaces.mockResolvedValueOnce([place]);
    m.isStaticMapsConfigured.mockReturnValueOnce(false);
    m.suggestSavedPlacesOnRoute.mockResolvedValueOnce([
      {
        place,
        origin: "Austin, TX",
        destination: "Moab, UT",
        startLocation: { latitude: 30.2672, longitude: -97.7431 },
        stopLocation: { latitude: 40.7608, longitude: -111.891 },
        endLocation: { latitude: 38.5733, longitude: -109.5498 },
        baseEncodedPolyline: "base-polyline",
        detourEncodedPolyline: "detour-polyline",
        distanceFromRouteMeters: 4_000,
        detourDurationSeconds: 240,
        detourDistanceMeters: 3_200,
        detourRatio: 0.01,
        withinDetourThreshold: false,
        routeDurationSeconds: 30_240,
        routeDistanceMeters: 1_003_200,
      },
    ]);

    const c = ctx(null);
    const result = await toolHandlers.suggest_saved_places_on_route(c, {
      origin: "Austin, TX",
      destination: "Moab, UT",
      include_maps: true,
    });

    expect(m.generateRouteComparisonMap).not.toHaveBeenCalled();
    expect(c.exports).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        maps_requested: true,
        maps_generated_count: 0,
        attached_files: [],
        suggestions: [
          expect.objectContaining({
            comparison_map_requested: true,
            comparison_map_generated: false,
            comparison_map_file: null,
            comparison_map_error: "GOOGLE_MAPS_API_KEY is not configured for Static Maps.",
          }),
        ],
      }),
    );
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

  it("search_place_details works without an active trip", async () => {
    m.searchPlaceDetails.mockResolvedValueOnce([
      {
        provider: "google_places",
        externalId: "moki",
        name: "Moki Dugway",
        category: "other",
        address: "UT-261, Utah",
        latitude: 37.274,
        longitude: -109.942,
        mapsUrl: "https://maps.google.com/?cid=moki",
        types: ["point_of_interest"],
      },
    ]);

    const result = await toolHandlers.search_place_details(ctx(null), {
      query: "Moki Dugway",
      destination: "Utah",
    });

    expect(m.getTrip).not.toHaveBeenCalled();
    expect(m.searchPlaceDetails).toHaveBeenCalledWith({
      query: "Moki Dugway",
      destination: "Utah",
      maxResults: undefined,
    });
    expect(result).toEqual([
      expect.objectContaining({
        external_id: "moki",
        maps_url: "https://maps.google.com/?cid=moki",
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

  it("clears the active trip without deleting it", async () => {
    const c = ctx(42);
    const result = await toolHandlers.clear_active_trip(c, {});
    expect(c.activeTripId).toBeNull();
    expect(m.setActiveTripId).toHaveBeenCalledWith(111, null);
    expect(m.deleteTrip).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, active: false });
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

describe("get_weather", () => {
  it("returns an error when weather is not configured", async () => {
    m.isWeatherConfigured.mockReturnValueOnce(false);
    const result = await toolHandlers.get_weather(ctx(7), { location: "Moab" });
    expect(result).toEqual({
      ok: false,
      error: "GOOGLE_MAPS_API_KEY is not configured for weather.",
    });
    expect(m.getWeather).not.toHaveBeenCalled();
  });

  it("uses the active trip destination when location is omitted", async () => {
    m.isWeatherConfigured.mockReturnValueOnce(true);
    m.getTrip.mockResolvedValueOnce({ id: 7, destination: "Utah" });
    m.getWeather.mockResolvedValueOnce({
      location: { label: "Utah", latitude: 39.3, longitude: -111.6 },
      time_zone: "America/Denver",
      units_system: "METRIC",
      current: { description: "Sunny", temperature: "22°C" },
      forecast_days: [],
    });

    const result = await toolHandlers.get_weather(ctx(7), { forecast_days: 0 });
    expect(m.getWeather).toHaveBeenCalledWith({
      location: "Utah",
      latitude: null,
      longitude: null,
      forecastDays: 0,
      unitsSystem: "METRIC",
    });
    expect(result).toMatchObject({ ok: true, current: { description: "Sunny" } });
  });

  it("passes an explicit location and forecast length", async () => {
    m.isWeatherConfigured.mockReturnValueOnce(true);
    m.getWeather.mockResolvedValueOnce({
      location: { label: "Paris", latitude: 48.85, longitude: 2.35 },
      time_zone: "Europe/Paris",
      units_system: "IMPERIAL",
      current: null,
      forecast_days: [{ date: "2026-06-03", description: "Rain", high: "70°F", low: "55°F" }],
    });

    await toolHandlers.get_weather(ctx(null), {
      location: "Paris",
      forecast_days: 2,
      units_system: "IMPERIAL",
    });

    expect(m.getWeather).toHaveBeenCalledWith({
      location: "Paris",
      latitude: null,
      longitude: null,
      forecastDays: 2,
      unitsSystem: "IMPERIAL",
    });
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

describe("start_gmail_connect", () => {
  it("returns an oauth start link when configured", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.startConnectFlow.mockResolvedValueOnce(
      "https://example.com/trip-planner/oauth/google/start?state=abc",
    );

    const result = await toolHandlers.start_gmail_connect(ctx(7));

    expect(m.startConnectFlow).toHaveBeenCalledWith(111);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        connect_url: "https://example.com/trip-planner/oauth/google/start?state=abc",
      }),
    );
  });

  it("reports when oauth is not configured", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(false);

    const result = await toolHandlers.start_gmail_connect(ctx(7));

    expect(m.startConnectFlow).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: "gmail_oauth_not_configured",
      }),
    );
  });
});

describe("list_gmail_accounts", () => {
  it("returns connected accounts", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.listAccounts.mockResolvedValueOnce([
      {
        id: 1,
        googleEmail: "personal@gmail.com",
        status: "active",
        connectedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);

    const result = await toolHandlers.list_gmail_accounts(ctx(7));

    expect(result).toMatchObject({
      ok: true,
      accounts: [
        {
          gmail_account_id: 1,
          google_email: "personal@gmail.com",
          status: "active",
          connected_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("disconnect_gmail_account", () => {
  it("requires explicit confirmation", async () => {
    await expect(
      toolHandlers.disconnect_gmail_account(ctx(7), { google_email: "work@gmail.com" }),
    ).rejects.toThrow(/confirmation/);
  });

  it("disconnects a confirmed account by email", async () => {
    m.getAccountByEmail.mockResolvedValueOnce({
      id: 2,
      googleEmail: "work@gmail.com",
      status: "active",
    });
    m.disconnectAccount.mockResolvedValueOnce(true);

    const result = await toolHandlers.disconnect_gmail_account(ctx(7), {
      google_email: "work@gmail.com",
      confirmed: true,
    });

    expect(m.disconnectAccount).toHaveBeenCalledWith(111, { googleEmail: "work@gmail.com" });
    expect(result).toEqual({ ok: true, google_email: "work@gmail.com" });
  });
});

describe("search_gmail", () => {
  it("returns not connected when there are no active accounts", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.listAccounts.mockResolvedValueOnce([]);
    const result = await toolHandlers.search_gmail(ctx(7), {});
    expect(result).toMatchObject({
      ok: false,
      error: "gmail_not_connected",
      connect_hint: 'Say "подключить почту" or "connect gmail" in Telegram.',
    });
  });

  it("searches all connected accounts by default", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.listAccounts.mockResolvedValueOnce([
      { id: 1, googleEmail: "personal@gmail.com", status: "active" },
      { id: 2, googleEmail: "work@gmail.com", status: "active" },
    ]);
    m.getTrip.mockResolvedValueOnce({
      id: 7,
      title: "Paris",
      destination: "Paris",
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-10"),
    });
    m.buildGmailSearchQuery.mockReturnValueOnce("after:2026/06/01 Paris");
    m.searchGmailAccounts.mockResolvedValueOnce({
      accounts_searched: ["personal@gmail.com", "work@gmail.com"],
      query_used: "after:2026/06/01 Paris",
      messages: [],
    });

    const result = await toolHandlers.search_gmail(ctx(7), {});

    expect(m.searchGmailAccounts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ googleEmail: "personal@gmail.com" }),
        expect.objectContaining({ googleEmail: "work@gmail.com" }),
      ]),
      expect.objectContaining({ q: "after:2026/06/01 Paris", maxResults: 10 }),
    );
    expect(result).toMatchObject({ ok: true, query_used: "after:2026/06/01 Paris" });
    expect(m.saveGmailSearchSession).toHaveBeenCalled();
  });

  it("filters to a specific google_email", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.listAccounts.mockResolvedValueOnce([
      { id: 1, googleEmail: "personal@gmail.com", status: "active" },
    ]);
    m.getAccountByEmail.mockResolvedValueOnce({
      id: 2,
      googleEmail: "work@gmail.com",
      status: "active",
    });
    m.buildGmailSearchQuery.mockReturnValueOnce("hotel");
    m.searchGmailAccounts.mockResolvedValueOnce({
      accounts_searched: ["work@gmail.com"],
      query_used: "hotel",
      messages: [],
    });

    await toolHandlers.search_gmail(ctx(7), { google_email: "work@gmail.com", query: "hotel" });

    expect(m.getAccountByEmail).toHaveBeenCalledWith(111, "work@gmail.com");
    expect(m.searchGmailAccounts).toHaveBeenCalledWith(
      [expect.objectContaining({ googleEmail: "work@gmail.com" })],
      expect.any(Object),
    );
  });
});

describe("export_gmail_message", () => {
  it("exports the message and attaches the eml file", async () => {
    m.isGmailOAuthConfigured.mockReturnValue(true);
    m.getAccountById.mockResolvedValueOnce({
      id: 2,
      googleEmail: "work@gmail.com",
      status: "active",
    });
    m.exportGmailMessageToEml.mockResolvedValueOnce({
      filePath: "/tmp/hotel-booking-msg1.eml",
      subject: "Hotel booking",
      from: "hotel@example.com",
      date: "Mon, 2 Jun 2026 10:00:00 +0000",
    });

    const c = ctx(7);
    const result = await toolHandlers.export_gmail_message(c, {
      gmail_account_id: 2,
      message_id: "msg-1",
    });

    expect(m.exportGmailMessageToEml).toHaveBeenCalledWith(
      expect.objectContaining({ googleEmail: "work@gmail.com" }),
      "msg-1",
    );
    expect(c.exports).toEqual(["/tmp/hotel-booking-msg1.eml"]);
    expect(result).toMatchObject({
      ok: true,
      account_email: "work@gmail.com",
      subject: "Hotel booking",
      format: "eml",
      file: "/tmp/hotel-booking-msg1.eml",
    });
  });
});
