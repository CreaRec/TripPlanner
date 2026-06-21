import { describe, expect, it, vi } from "vitest";
import { lookupAirportByIata, lookupFlight } from "./aviationStack";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("lookupFlight", () => {
  it("returns null without an API key", async () => {
    await expect(lookupFlight({ flightIata: "AS215" }, { apiKey: "" })).resolves.toBeNull();
  });

  it("returns parsed flight data", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            flight_date: "2026-07-01",
            flight_status: "scheduled",
            departure: {
              airport: "San Francisco International",
              iata: "SFO",
              icao: "KSFO",
              terminal: "2",
              gate: "D11",
              scheduled: "2026-07-01T16:20:00+00:00",
            },
            arrival: {
              airport: "John F Kennedy International",
              iata: "JFK",
              icao: "KJFK",
              terminal: "8",
              gate: "B22",
              scheduled: "2026-07-02T00:45:00+00:00",
            },
            airline: { name: "Alaska Airlines", iata: "AS", icao: "ASA" },
            flight: { number: "215", iata: "AS215", icao: "ASA215" },
          },
        ],
      }),
    );

    const result = await lookupFlight(
      { flightIata: "AS215", flightDate: "2026-07-01" },
      { apiKey: "test-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.aviationstack.com/v1/flights"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl.mock.calls[0][0]).toContain("flight_iata=AS215");
    expect(fetchImpl.mock.calls[0][0]).toContain("flight_date=2026-07-01");
    expect(result).toEqual(
      expect.objectContaining({
        flightStatus: "scheduled",
        airlineName: "Alaska Airlines",
        flightIata: "AS215",
        departure: expect.objectContaining({ iata: "SFO", gate: "D11", terminal: "2" }),
        arrival: expect.objectContaining({ iata: "JFK", gate: "B22", terminal: "8" }),
      }),
    );
  });

  it("returns null on API error response", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: { code: "invalid_access_key", message: "Invalid access key." } }),
    );

    await expect(
      lookupFlight({ flightIata: "AS215" }, { apiKey: "bad-key", fetchImpl }),
    ).resolves.toBeNull();
  });

  it("returns null on HTTP failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

    await expect(
      lookupFlight({ flightIata: "AS215" }, { apiKey: "test-key", fetchImpl }),
    ).resolves.toBeNull();
  });
});

describe("lookupAirportByIata", () => {
  it("returns null without an API key", async () => {
    await expect(lookupAirportByIata("SFO", { apiKey: "" })).resolves.toBeNull();
  });

  it("returns null for invalid IATA codes", async () => {
    const fetchImpl = vi.fn();
    await expect(
      lookupAirportByIata("San Francisco", { apiKey: "test-key", fetchImpl }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns parsed airport data", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            iata_code: "SFO",
            icao_code: "KSFO",
            airport_name: "San Francisco International",
            city_iata: "SFO",
            country_name: "United States",
            latitude: "37.61897",
            longitude: "-122.37489",
          },
        ],
      }),
    );

    const result = await lookupAirportByIata("sfo", { apiKey: "test-key", fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toContain("iata_code=SFO");
    expect(result).toEqual(
      expect.objectContaining({
        iata: "SFO",
        name: "San Francisco International",
        latitude: 37.61897,
        longitude: -122.37489,
      }),
    );
  });
});
