import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  searchGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    savedPlace: {
      create: m.create,
      findMany: m.findMany,
      findFirst: m.findFirst,
      update: m.update,
      deleteMany: m.deleteMany,
    },
  },
}));

vi.mock("./googlePlaces", () => ({
  searchGooglePlaces: m.searchGooglePlaces,
  getGooglePlaceDetails: m.getGooglePlaceDetails,
}));

import { enrichSavedPlace, saveInterestingPlace } from "./savedPlaces";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    telegramId: BigInt(111),
    name: "Crater Lake",
    category: "national_park",
    address: "Oregon",
    latitude: 42.9446,
    longitude: -122.109,
    externalProvider: "google_places",
    externalId: "g-crater",
    websiteUrl: null,
    mapsUrl: null,
    phone: null,
    bookingUrl: null,
    ticketUrl: null,
    reservationRecommended: false,
    openingHours: null,
    rating: null,
    priceLevel: null,
    priority: null,
    durationMin: null,
    kidFriendly: null,
    status: "want_to_visit",
    sourceNote: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("savedPlaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a manual place when Google search has no match", async () => {
    m.searchGooglePlaces.mockResolvedValueOnce([]);
    m.create.mockResolvedValueOnce(
      row({ name: "Mystery overlook", address: null, externalProvider: null, externalId: null, mapsUrl: null, latitude: null, longitude: null }),
    );

    const result = await saveInterestingPlace({
      telegramId: 111,
      query: "Mystery overlook",
      sourceNote: "heard from a friend",
    });

    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telegramId: BigInt(111),
          name: "Mystery overlook",
          sourceNote: "heard from a friend",
        }),
      }),
    );
    expect(result).toMatchObject({
      created: true,
      googlePlace: null,
      enriched: false,
      missingFields: ["address", "maps_url", "coordinates"],
    });
  });

  it("updates an existing Google-backed place instead of duplicating it", async () => {
    const existing = row({ id: 5, notes: "Original note" });
    const updated = row({ id: 5, notes: "Original note\nCheck permits." });
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "g-crater" }]);
    m.getGooglePlaceDetails.mockResolvedValueOnce({
      provider: "google_places",
      externalId: "g-crater",
      name: "Crater Lake National Park",
      category: "national_park",
      address: "Oregon",
      latitude: 42.9446,
      longitude: -122.109,
      websiteUrl: "https://www.nps.gov/crla",
      mapsUrl: "https://maps.google.com/?cid=crater",
      phone: null,
      openingHours: null,
      rating: 4.9,
      priceLevel: null,
      reservationRecommended: true,
      bookingUrl: null,
      ticketUrl: "https://www.nps.gov/crla",
      advice: "Check permits.",
      types: ["national_park"],
    });
    m.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
    m.update.mockResolvedValueOnce(updated);

    const result = await saveInterestingPlace({ telegramId: 111, query: "Crater Lake" });

    expect(m.create).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          name: "Crater Lake National Park",
          externalProvider: "google_places",
          externalId: "g-crater",
        }),
      }),
    );
    expect(result).toMatchObject({ created: false, place: { id: 5 }, enriched: true });
  });

  it("enriches an existing saved place with Google details", async () => {
    const existing = row({ id: 5, name: "The View Restaurant", notes: null });
    const updated = row({
      id: 5,
      name: "The View Restaurant",
      websiteUrl: "https://example.com",
      mapsUrl: "https://maps.google.com/?cid=view",
      phone: "+1 555 0100",
      rating: 4.5,
    });
    m.getGooglePlaceDetails.mockResolvedValueOnce({
      provider: "google_places",
      externalId: "g-view",
      name: "The View Restaurant",
      category: "restaurant",
      address: "Monument Valley",
      latitude: 36.98,
      longitude: -110.11,
      websiteUrl: "https://example.com",
      mapsUrl: "https://maps.google.com/?cid=view",
      phone: "+1 555 0100",
      openingHours: null,
      rating: 4.5,
      priceLevel: 2,
      reservationRecommended: false,
      bookingUrl: null,
      ticketUrl: null,
      advice: null,
      types: ["restaurant"],
    });
    m.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    m.searchGooglePlaces.mockResolvedValueOnce([{ externalId: "g-view" }]);
    m.update.mockResolvedValueOnce(updated);

    const result = await enrichSavedPlace({ telegramId: 111, savedPlaceId: 5 });

    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          websiteUrl: "https://example.com",
          mapsUrl: "https://maps.google.com/?cid=view",
          phone: "+1 555 0100",
        }),
      }),
    );
    expect(result).toMatchObject({ updated: true, duplicateSavedPlaceId: null, enriched: true });
  });
});
