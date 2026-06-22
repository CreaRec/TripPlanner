import { describe, expect, it, vi } from "vitest";
import {
  getGooglePlaceDetails,
  mapGoogleTypesToPlaceCategory,
  searchGooglePlaces,
} from "./googlePlaces";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("mapGoogleTypesToPlaceCategory", () => {
  it("maps Google place types to local categories", () => {
    expect(mapGoogleTypesToPlaceCategory(["restaurant", "point_of_interest"])).toBe("restaurant");
    expect(mapGoogleTypesToPlaceCategory(["museum"])).toBe("museum");
    expect(mapGoogleTypesToPlaceCategory(["national_park", "tourist_attraction"])).toBe("national_park");
    expect(mapGoogleTypesToPlaceCategory(["travel_agency"])).toBe("tour");
    expect(mapGoogleTypesToPlaceCategory(["unknown"])).toBe("other");
  });
});

describe("searchGooglePlaces", () => {
  it("requires an API key", async () => {
    await expect(searchGooglePlaces("Louvre", { apiKey: "" })).rejects.toThrow(/GOOGLE_MAPS_API_KEY/);
  });

  it("searches using query and destination", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        places: [
          {
            id: "places/abc",
            displayName: { text: "Louvre Museum" },
            formattedAddress: "Rue de Rivoli, Paris",
            location: { latitude: 48.8606, longitude: 2.3376 },
            types: ["museum", "tourist_attraction"],
            googleMapsUri: "https://maps.google.com/?cid=abc",
          },
        ],
      }),
    );

    const result = await searchGooglePlaces("Louvre", {
      apiKey: "key",
      destination: "Paris",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Louvre, Paris"),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        externalId: "places/abc",
        name: "Louvre Museum",
        category: "museum",
        address: "Rue de Rivoli, Paris",
      }),
    ]);
  });

  it("formats Google API errors with actionable details", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 403,
            message: "Places API has not been used in project 123 before or it is disabled.",
            status: "PERMISSION_DENIED",
            details: [
              {
                reason: "SERVICE_DISABLED",
                domain: "googleapis.com",
                metadata: { service: "places.googleapis.com", consumer: "projects/123" },
              },
            ],
          },
        },
        { status: 403 },
      ),
    );

    await expect(searchGooglePlaces("Louvre", { apiKey: "key", fetchImpl })).rejects.toThrow(
      /status=PERMISSION_DENIED.*reason=SERVICE_DISABLED.*service=places\.googleapis\.com/,
    );
  });
});

describe("getGooglePlaceDetails", () => {
  it("parses details and ticket advice", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "places/abc",
        displayName: { text: "Louvre Museum" },
        formattedAddress: "Rue de Rivoli, Paris",
        location: { latitude: 48.8606, longitude: 2.3376 },
        types: ["museum"],
        websiteUri: "https://www.louvre.fr",
        googleMapsUri: "https://maps.google.com/?cid=abc",
        nationalPhoneNumber: "01 40 20 50 50",
        rating: 4.7,
        priceLevel: "PRICE_LEVEL_MODERATE",
        regularOpeningHours: { weekdayDescriptions: ["Closed Tuesday"] },
      }),
    );

    const result = await getGooglePlaceDetails("places/abc", { apiKey: "key", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places/places%2Fabc",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      externalId: "places/abc",
      category: "museum",
      websiteUrl: "https://www.louvre.fr",
      ticketUrl: "https://www.louvre.fr",
      reservationRecommended: true,
      rating: 4.7,
      priceLevel: 2,
    });
  });
});
