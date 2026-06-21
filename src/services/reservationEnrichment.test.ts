import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  addReservation: vi.fn(),
  updateReservation: vi.fn(),
  resolveGoogleExternalId: vi.fn(),
  fetchGooglePlaceDetails: vi.fn(),
}));

vi.mock("./reservations", () => ({
  addReservation: m.addReservation,
  updateReservation: m.updateReservation,
}));

vi.mock("./enrichmentUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enrichmentUtils")>();
  return {
    ...actual,
    resolveGoogleExternalId: m.resolveGoogleExternalId,
    fetchGooglePlaceDetails: m.fetchGooglePlaceDetails,
  };
});

import {
  parseFlightEndpoints,
  reservationMissingFields,
  saveReservationWithEnrichment,
  updateReservationWithEnrichment,
} from "./reservationEnrichment";

const hotelGoogle = {
  provider: "google_places",
  externalId: "g-hotel",
  name: "Grand Hotel",
  category: "other" as const,
  address: "1 Main St, Paris",
  latitude: 48.8,
  longitude: 2.3,
  mapsUrl: "https://maps.example/hotel",
  websiteUrl: null,
  phone: "+33123456789",
  openingHours: null,
  rating: 4.5,
  priceLevel: 3,
  reservationRecommended: false,
  bookingUrl: null,
  ticketUrl: null,
  advice: null,
  types: ["lodging"],
};

describe("parseFlightEndpoints", () => {
  it("parses IATA codes from title", () => {
    expect(parseFlightEndpoints("AS215 SFO-JFK", {})).toEqual({
      origin: "SFO",
      destination: "JFK",
    });
  });

  it("reads endpoints from metadata", () => {
    expect(
      parseFlightEndpoints("Flight", { origin_airport: "SEA", destination_airport: "LAX" }),
    ).toEqual({ origin: "SEA", destination: "LAX" });
  });
});

describe("reservationMissingFields", () => {
  it("flags hotel gaps", () => {
    const missing = reservationMissingFields(
      {
        type: "hotel",
        title: "Hotel",
        address: null,
        startAt: null,
        endAt: null,
        confirmationNumber: null,
        metadata: {},
      } as never,
      false,
    );
    expect(missing).toContain("address");
    expect(missing).toContain("start_at");
    expect(missing).toContain("end_at");
  });
});

describe("saveReservationWithEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches hotel address from Google Places", async () => {
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-hotel");
    m.fetchGooglePlaceDetails.mockResolvedValueOnce(hotelGoogle);
    m.addReservation.mockResolvedValueOnce({
      id: 1,
      type: "hotel",
      title: "Grand Hotel",
      address: "1 Main St, Paris",
      startAt: new Date("2026-07-01"),
      endAt: new Date("2026-07-05"),
      confirmationNumber: "ABC",
      metadata: { maps_url: "https://maps.example/hotel" },
    });

    const result = await saveReservationWithEnrichment({
      tripId: 7,
      type: "hotel",
      title: "Grand Hotel",
      provider: "Booking.com",
      startAt: "2026-07-01",
      endAt: "2026-07-05",
      confirmationNumber: "ABC",
      destination: "Paris",
    });

    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "1 Main St, Paris",
        metadata: expect.objectContaining({ maps_url: "https://maps.example/hotel" }),
      }),
    );
    expect(result.enriched).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("falls back to raw save when Google lookup fails", async () => {
    m.resolveGoogleExternalId.mockRejectedValueOnce(new Error("no key"));
    m.addReservation.mockResolvedValueOnce({
      id: 2,
      type: "hotel",
      title: "Mystery Hotel",
      address: null,
      startAt: null,
      endAt: null,
      confirmationNumber: null,
      metadata: {},
    });

    const result = await saveReservationWithEnrichment({
      tripId: 7,
      type: "hotel",
      title: "Mystery Hotel",
      destination: "Paris",
    });

    expect(result.enriched).toBe(false);
    expect(result.missingFields).toContain("address");
    expect(result.missingFields).toContain("start_at");
  });

  it("enriches flight airports into metadata", async () => {
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-sfo").mockResolvedValueOnce("g-jfk");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({ ...hotelGoogle, name: "San Francisco International Airport", address: "SFO" })
      .mockResolvedValueOnce({ ...hotelGoogle, name: "JFK Airport", address: "JFK" });
    m.addReservation.mockResolvedValueOnce({
      id: 3,
      type: "flight",
      title: "SFO-JFK",
      address: "San Francisco International Airport → JFK Airport",
      startAt: new Date("2026-07-01"),
      endAt: null,
      confirmationNumber: "XYZ",
      metadata: {
        origin_name: "San Francisco International Airport",
        destination_name: "JFK Airport",
      },
    });

    const result = await saveReservationWithEnrichment({
      tripId: 7,
      type: "flight",
      title: "AS215 SFO-JFK",
      confirmationNumber: "XYZ",
      startAt: "2026-07-01",
      destination: "US",
    });

    expect(result.enriched).toBe(true);
    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          origin_name: "San Francisco International Airport",
          destination_name: "JFK Airport",
        }),
      }),
    );
  });
});

describe("updateReservationWithEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when reservation is not in trip", async () => {
    m.updateReservation.mockResolvedValueOnce(null);
    await expect(
      updateReservationWithEnrichment(
        7,
        99,
        { title: "New" },
        { id: 99, type: "hotel", title: "Old", address: null, metadata: {} } as never,
        "Paris",
      ),
    ).resolves.toBeNull();
  });
});
