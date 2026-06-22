import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  addReservation: vi.fn(),
  updateReservation: vi.fn(),
  resolveGoogleExternalId: vi.fn(),
  fetchGooglePlaceDetails: vi.fn(),
  lookupFlight: vi.fn(),
  lookupAirportByIata: vi.fn(),
}));

vi.mock("../../config", () => ({
  isAviationStackConfigured: vi.fn(() => true),
}));

vi.mock("./reservations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reservations")>();
  return {
    ...actual,
    addReservation: m.addReservation,
    updateReservation: m.updateReservation,
  };
});

vi.mock("./enrichmentUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enrichmentUtils")>();
  return {
    ...actual,
    resolveGoogleExternalId: m.resolveGoogleExternalId,
    fetchGooglePlaceDetails: m.fetchGooglePlaceDetails,
  };
});

vi.mock("../providers/aviationStack", () => ({
  lookupFlight: m.lookupFlight,
  lookupAirportByIata: m.lookupAirportByIata,
}));

import { ExternalProvider } from "./externalProvider";
import {
  parseFlightEndpoints,
  parseFlightNumber,
  reEnrichReservation,
  reservationMissingFields,
  saveReservationWithEnrichment,
  updateReservationWithEnrichment,
} from "./reservationEnrichment";

const hotelGoogle = {
  provider: ExternalProvider.GooglePlaces,
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

const aviationFlight = {
  flightDate: "2026-07-01",
  flightStatus: "scheduled",
  airlineName: "Alaska Airlines",
  airlineIata: "AS",
  flightIata: "AS215",
  flightNumber: "215",
  departure: {
    airport: "San Francisco International",
    iata: "SFO",
    icao: "KSFO",
    terminal: "2",
    gate: "D11",
    scheduled: "2026-07-01T16:20:00+00:00",
    estimated: null,
    delay: null,
  },
  arrival: {
    airport: "John F Kennedy International",
    iata: "JFK",
    icao: "KJFK",
    terminal: "8",
    gate: "B22",
    scheduled: "2026-07-02T00:45:00+00:00",
    estimated: null,
    delay: null,
  },
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

  it("reads legacy from/to and route metadata", () => {
    expect(parseFlightEndpoints("Flight", { from: "AUS", to: "SEA" })).toEqual({
      origin: "AUS",
      destination: "SEA",
    });
    expect(parseFlightEndpoints("Flight", { route: "AUS → SEA" })).toEqual({
      origin: "AUS",
      destination: "SEA",
    });
  });
});

describe("parseFlightNumber", () => {
  it("reads flight number from metadata", () => {
    expect(parseFlightNumber("Flight", { flight_number: "as 215" })).toBe("AS215");
  });

  it("parses flight number from title", () => {
    expect(parseFlightNumber("AS215 SFO-JFK", {})).toBe("AS215");
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
    m.lookupFlight.mockResolvedValue(null);
    m.lookupAirportByIata.mockResolvedValue(null);
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
    expect(m.lookupFlight).not.toHaveBeenCalled();
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

  it("enriches flight via Aviation Stack with full schedule and gates", async () => {
    m.lookupFlight.mockResolvedValueOnce(aviationFlight);
    m.lookupAirportByIata
      .mockResolvedValueOnce({
        iata: "SFO",
        name: "San Francisco International",
        city: "San Francisco",
        country: "United States",
        latitude: 37.61,
        longitude: -122.37,
      })
      .mockResolvedValueOnce({
        iata: "JFK",
        name: "John F Kennedy International",
        city: "New York",
        country: "United States",
        latitude: 40.64,
        longitude: -73.78,
      });
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-sfo").mockResolvedValueOnce("g-jfk");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({
        ...hotelGoogle,
        name: "San Francisco International Airport",
        mapsUrl: "https://maps.example/sfo",
      })
      .mockResolvedValueOnce({
        ...hotelGoogle,
        name: "JFK Airport",
        mapsUrl: "https://maps.example/jfk",
      });
    m.addReservation.mockResolvedValueOnce({
      id: 3,
      type: "flight",
      title: "SFO-JFK",
      provider: "Alaska Airlines",
      address: "San Francisco International → John F Kennedy International",
      startAt: new Date("2026-07-01T16:20:00+00:00"),
      endAt: new Date("2026-07-02T00:45:00+00:00"),
      confirmationNumber: "XYZ",
      metadata: {},
    });

    const result = await saveReservationWithEnrichment({
      tripId: 7,
      type: "flight",
      title: "AS215 SFO-JFK",
      confirmationNumber: "XYZ",
      startAt: "2026-07-01",
      destination: "US",
    });

    expect(m.lookupFlight).toHaveBeenCalledWith({
      flightIata: "AS215",
      flightDate: "2026-07-01",
    });
    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "Alaska Airlines",
        startAt: "2026-07-01",
        endAt: "2026-07-02T00:45:00+00:00",
        metadata: expect.objectContaining({
          flight_number: "AS215",
          flight_status: "scheduled",
          origin_terminal: "2",
          origin_gate: "D11",
          destination_terminal: "8",
          destination_gate: "B22",
          origin_airport: "SFO",
          destination_airport: "JFK",
          enrichment_provider: ExternalProvider.AviationStack,
        }),
      }),
    );
    expect(result.enriched).toBe(true);
  });

  it("falls back to Google Places when Aviation Stack flight lookup fails", async () => {
    m.lookupFlight.mockResolvedValueOnce(null);
    m.lookupAirportByIata.mockResolvedValue(null);
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-sfo").mockResolvedValueOnce("g-jfk");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({ ...hotelGoogle, name: "San Francisco International Airport", address: "SFO" })
      .mockResolvedValueOnce({ ...hotelGoogle, name: "JFK Airport", address: "JFK" });
    m.addReservation.mockResolvedValueOnce({
      id: 4,
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
    expect(m.fetchGooglePlaceDetails).toHaveBeenCalledTimes(2);
    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          origin_name: "San Francisco International Airport",
          destination_name: "JFK Airport",
        }),
      }),
    );
  });

  it("uses Aviation Stack airports when flight lookup fails but IATA lookup succeeds", async () => {
    m.lookupFlight.mockResolvedValueOnce(null);
    m.lookupAirportByIata
      .mockResolvedValueOnce({
        iata: "SFO",
        name: "San Francisco International",
        city: "San Francisco",
        country: "United States",
        latitude: 37.61,
        longitude: -122.37,
      })
      .mockResolvedValueOnce({
        iata: "JFK",
        name: "John F Kennedy International",
        city: "New York",
        country: "United States",
        latitude: 40.64,
        longitude: -73.78,
      });
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-sfo").mockResolvedValueOnce("g-jfk");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({ ...hotelGoogle, mapsUrl: "https://maps.example/sfo" })
      .mockResolvedValueOnce({ ...hotelGoogle, mapsUrl: "https://maps.example/jfk" });
    m.addReservation.mockResolvedValueOnce({
      id: 5,
      type: "flight",
      title: "SFO-JFK",
      address: "San Francisco International → John F Kennedy International",
      startAt: null,
      endAt: null,
      confirmationNumber: null,
      metadata: {},
    });

    const result = await saveReservationWithEnrichment({
      tripId: 7,
      type: "flight",
      title: "SFO-JFK",
      destination: "US",
    });

    expect(m.lookupAirportByIata).toHaveBeenCalledWith("SFO");
    expect(m.lookupAirportByIata).toHaveBeenCalledWith("JFK");
    expect(result.enriched).toBe(true);
    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          origin_name: "San Francisco International",
          destination_name: "John F Kennedy International",
          enrichment_provider: ExternalProvider.AviationStack,
        }),
      }),
    );
  });

  it("does not overwrite user-provided provider, times, or seat metadata", async () => {
    m.lookupFlight.mockResolvedValueOnce(aviationFlight);
    m.lookupAirportByIata.mockResolvedValue(null);
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-sfo").mockResolvedValueOnce("g-jfk");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({ ...hotelGoogle, name: "SFO", mapsUrl: "https://maps.example/sfo" })
      .mockResolvedValueOnce({ ...hotelGoogle, name: "JFK", mapsUrl: "https://maps.example/jfk" });
    m.addReservation.mockResolvedValueOnce({
      id: 6,
      type: "flight",
      title: "AS215 SFO-JFK",
      provider: "My Airline",
      address: "SFO → JFK",
      startAt: new Date("2026-07-01T10:00:00+00:00"),
      endAt: new Date("2026-07-01T18:00:00+00:00"),
      confirmationNumber: "XYZ",
      metadata: { seat: "17B" },
    });

    await saveReservationWithEnrichment({
      tripId: 7,
      type: "flight",
      title: "AS215 SFO-JFK",
      provider: "My Airline",
      startAt: "2026-07-01T10:00:00+00:00",
      endAt: "2026-07-01T18:00:00+00:00",
      confirmationNumber: "XYZ",
      metadata: { seat: "17B" },
      destination: "US",
    });

    expect(m.addReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "My Airline",
        startAt: "2026-07-01T10:00:00+00:00",
        endAt: "2026-07-01T18:00:00+00:00",
        metadata: expect.objectContaining({ seat: "17B" }),
      }),
    );
  });
});

describe("updateReservationWithEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.lookupFlight.mockResolvedValue(null);
    m.lookupAirportByIata.mockResolvedValue(null);
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

describe("reEnrichReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("force-refreshes flight metadata and reports aviation stack telemetry", async () => {
    m.lookupFlight.mockResolvedValueOnce(aviationFlight);
    m.lookupAirportByIata
      .mockResolvedValueOnce({
        iata: "AUS",
        name: "Austin-Bergstrom International",
        city: "Austin",
        country: "United States",
        latitude: 30.19,
        longitude: -97.67,
      })
      .mockResolvedValueOnce({
        iata: "SEA",
        name: "Seattle-Tacoma International",
        city: "Seattle",
        country: "United States",
        latitude: 47.45,
        longitude: -122.31,
      });
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-aus").mockResolvedValueOnce("g-sea");
    m.fetchGooglePlaceDetails
      .mockResolvedValueOnce({ ...hotelGoogle, mapsUrl: "https://maps.example/aus" })
      .mockResolvedValueOnce({ ...hotelGoogle, mapsUrl: "https://maps.example/sea" });
    m.updateReservation.mockResolvedValueOnce({
      id: 6,
      tripId: 1,
      type: "flight",
      title: "Alaska Airlines AS 215 — Austin to Seattle",
      provider: "Alaska Airlines",
      confirmationNumber: "FLFLOD",
      startAt: new Date("2026-07-13T13:30:00.000Z"),
      endAt: new Date("2026-07-13T17:58:00.000Z"),
      address: "Austin-Bergstrom International → Seattle-Tacoma International",
      status: "booked",
      notes: null,
      metadata: {
        seat: "17B",
        route: "AUS -> SEA",
        flight_status: "scheduled",
        enrichment_provider: ExternalProvider.AviationStack,
      },
    });

    const result = await reEnrichReservation(
      {
        id: 6,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 215 — Austin to Seattle",
        provider: "Alaska Airlines",
        confirmationNumber: "FLFLOD",
        startAt: new Date("2026-07-13T13:30:00.000Z"),
        endAt: new Date("2026-07-13T17:58:00.000Z"),
        address: null,
        status: "booked",
        notes: null,
        metadata: { seat: "17B", route: "AUS -> SEA", flight_number: "AS 215" },
      } as never,
      "US",
    );

    expect(m.lookupFlight).toHaveBeenCalledWith({
      flightIata: "AS215",
      flightDate: "2026-07-13",
    });
    expect(m.updateReservation).toHaveBeenCalledWith(
      1,
      6,
      expect.objectContaining({
        metadata: expect.objectContaining({
          seat: "17B",
          route: "AUS -> SEA",
          flight_status: "scheduled",
          enrichment_provider: ExternalProvider.AviationStack,
        }),
      }),
    );
    expect(result.enriched).toBe(true);
    expect(result.enrichmentProvider).toBe(ExternalProvider.AviationStack);
    expect(result.telemetry.aviationStackFlightRequested).toBe(true);
    expect(result.telemetry.aviationStackFlightMatched).toBe(true);
    expect(result.telemetry.aviationStackAirportRequests).toBeGreaterThan(0);
  });

  it("force-refreshes hotel metadata via Google Places", async () => {
    m.resolveGoogleExternalId.mockResolvedValueOnce("g-hotel");
    m.fetchGooglePlaceDetails.mockResolvedValueOnce(hotelGoogle);
    m.updateReservation.mockResolvedValueOnce({
      id: 10,
      tripId: 1,
      type: "hotel",
      title: "Grand Hotel",
      provider: "Booking.com",
      confirmationNumber: "ABC",
      startAt: new Date("2026-07-01"),
      endAt: new Date("2026-07-05"),
      address: "1 Main St, Paris",
      status: "booked",
      notes: null,
      metadata: {
        enrichment_provider: ExternalProvider.GooglePlaces,
        maps_url: "https://maps.example/hotel",
      },
    });

    const result = await reEnrichReservation(
      {
        id: 10,
        tripId: 1,
        type: "hotel",
        title: "Grand Hotel",
        provider: "Booking.com",
        confirmationNumber: "ABC",
        startAt: new Date("2026-07-01"),
        endAt: new Date("2026-07-05"),
        address: "Old address",
        status: "booked",
        notes: null,
        metadata: {
          maps_url: "https://maps.example/old",
          custom_note: "keep me",
        },
      } as never,
      "Paris",
    );

    expect(m.lookupFlight).not.toHaveBeenCalled();
    expect(m.fetchGooglePlaceDetails).toHaveBeenCalled();
    expect(m.updateReservation).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({
        address: "1 Main St, Paris",
        metadata: expect.objectContaining({
          custom_note: "keep me",
          maps_url: "https://maps.example/hotel",
          enrichment_provider: ExternalProvider.GooglePlaces,
        }),
      }),
    );
    expect(result.enriched).toBe(true);
    expect(result.enrichmentProvider).toBe(ExternalProvider.GooglePlaces);
    expect(result.telemetry.googlePlacesRequests).toBe(1);
  });
});
