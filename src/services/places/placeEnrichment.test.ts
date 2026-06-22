import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getGooglePlaceDetails: vi.fn(),
  searchGooglePlaces: vi.fn(),
  findPlaceByExternalId: vi.fn(),
  getPlace: vi.fn(),
  addPlace: vi.fn(),
  updatePlace: vi.fn(),
}));

vi.mock("../providers/googlePlaces", () => ({
  getGooglePlaceDetails: m.getGooglePlaceDetails,
  searchGooglePlaces: m.searchGooglePlaces,
}));

vi.mock("./places", () => ({
  DEFAULT_PLACE_CATEGORY: "other",
  findPlaceByExternalId: m.findPlaceByExternalId,
  getPlace: m.getPlace,
  addPlace: m.addPlace,
  updatePlace: m.updatePlace,
}));

import { enrichPlace, saveTripPlace, searchPlaceDetails } from "./placeEnrichment";

describe("searchPlaceDetails", () => {
  it("delegates to Google Places search", async () => {
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "abc", name: "Louvre" }]);
    const result = await searchPlaceDetails({ query: "Louvre", destination: "Paris", maxResults: 3 });
    expect(m.searchGooglePlaces).toHaveBeenCalledWith("Louvre", {
      destination: "Paris",
      maxResults: 3,
    });
    expect(result).toEqual([{ externalId: "abc", name: "Louvre" }]);
  });
});

describe("enrichPlace", () => {
  const place = { id: 5, tripId: 7, name: "Louvre", category: "other", notes: "Go early" };
  const googlePlace = {
    provider: "google_places",
    externalId: "abc",
    name: "Louvre Museum",
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
    openingHours: { weekdayDescriptions: ["Closed Tuesday"] },
    rating: 4.7,
    priceLevel: 2,
    advice: "Check tickets, timed entry, or permits on the official website.",
    types: ["museum"],
  };

  it("returns nulls when the place is outside the trip", async () => {
    m.getPlace.mockResolvedValueOnce(null);
    await expect(enrichPlace({ tripId: 7, placeId: 5 })).resolves.toEqual({
      place: null,
      googlePlace: null,
      updated: false,
      duplicatePlaceId: null,
      enriched: false,
      missingFields: [],
    });
  });

  it("updates the place with Google details and advice", async () => {
    m.getPlace.mockResolvedValueOnce(place);
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "abc" }]);
    m.getGooglePlaceDetails.mockResolvedValueOnce(googlePlace);
    m.findPlaceByExternalId.mockResolvedValueOnce(null);
    m.updatePlace.mockResolvedValueOnce({ ...place, name: "Louvre Museum" });

    const result = await enrichPlace({ tripId: 7, placeId: 5, destination: "Paris" });

    expect(m.updatePlace).toHaveBeenCalledWith(
      7,
      5,
      expect.objectContaining({
        name: "Louvre Museum",
        category: "museum",
        externalProvider: "google_places",
        externalId: "abc",
        ticketUrl: "https://www.louvre.fr",
        reservationRecommended: true,
        notes: "Go early\nCheck tickets, timed entry, or permits on the official website.",
      }),
    );
    expect(result).toMatchObject({ updated: true, duplicatePlaceId: null, enriched: true });
  });

  it("does not update when another place already has the Google id", async () => {
    m.getPlace.mockResolvedValueOnce(place);
    m.getGooglePlaceDetails.mockResolvedValueOnce(googlePlace);
    m.findPlaceByExternalId.mockResolvedValueOnce({ id: 9, name: "Existing Louvre" });

    const result = await enrichPlace({ tripId: 7, placeId: 5, externalId: "abc" });

    expect(m.updatePlace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updated: false, duplicatePlaceId: 9, enriched: true });
  });
});

describe("saveTripPlace", () => {
  const googlePlace = {
    provider: "google_places",
    externalId: "abc",
    name: "Louvre Museum",
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
    openingHours: null,
    rating: 4.7,
    priceLevel: 2,
    advice: "Check tickets.",
    types: ["museum"],
  };

  it("creates a manual place when Google search has no match", async () => {
    m.searchGooglePlaces.mockResolvedValueOnce([]);
    m.addPlace.mockResolvedValueOnce({ id: 5, name: "Mystery overlook" });

    const result = await saveTripPlace({ tripId: 7, query: "Mystery overlook", notes: "Stop here" });

    expect(m.addPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 7,
        name: "Mystery overlook",
        notes: "Stop here",
      }),
    );
    expect(result).toMatchObject({
      created: true,
      googlePlace: null,
      duplicatePlaceId: null,
      enriched: false,
      missingFields: ["address", "maps_url", "coordinates"],
    });
  });

  it("creates an enriched place when Google has a match", async () => {
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "abc" }]);
    m.getGooglePlaceDetails.mockResolvedValueOnce(googlePlace);
    m.findPlaceByExternalId.mockResolvedValueOnce(null);
    m.addPlace.mockResolvedValueOnce({
      id: 5,
      name: "Louvre Museum",
      address: "Rue de Rivoli",
      mapsUrl: "https://maps.google.com/?cid=abc",
      latitude: 48.8606,
      longitude: 2.3376,
      externalId: "abc",
    });

    const result = await saveTripPlace({ tripId: 7, query: "Louvre", destination: "Paris" });

    expect(m.addPlace).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 7,
        name: "Louvre Museum",
        externalProvider: "google_places",
        externalId: "abc",
        mapsUrl: "https://maps.google.com/?cid=abc",
      }),
    );
    expect(result).toMatchObject({
      created: true,
      place: { id: 5 },
      duplicatePlaceId: null,
      enriched: true,
      missingFields: [],
    });
  });

  it("updates an existing Google-backed place instead of duplicating it", async () => {
    const existing = { id: 9, name: "Louvre", notes: "Go early" };
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "abc" }]);
    m.getGooglePlaceDetails.mockResolvedValueOnce(googlePlace);
    m.findPlaceByExternalId.mockResolvedValueOnce(existing);
    m.updatePlace.mockResolvedValueOnce({
      ...existing,
      name: "Louvre Museum",
      address: "Rue de Rivoli",
      mapsUrl: "https://maps.google.com/?cid=abc",
      latitude: 48.8606,
      longitude: 2.3376,
      externalId: "abc",
    });

    const result = await saveTripPlace({ tripId: 7, query: "Louvre", destination: "Paris" });

    expect(m.addPlace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: false, duplicatePlaceId: 9, enriched: true });
  });
});
