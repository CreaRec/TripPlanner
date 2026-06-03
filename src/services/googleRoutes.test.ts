import { describe, expect, it, vi } from "vitest";
import { suggestSavedPlacesOnRoute } from "./googleRoutes";
import type { SavedPlace } from "./savedPlaces";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function savedPlace(id: number, latitude: number, longitude: number): SavedPlace {
  return {
    id,
    telegramId: BigInt(111),
    name: `Place ${id}`,
    category: "natural_attraction",
    address: null,
    latitude,
    longitude,
    externalProvider: "google_places",
    externalId: `g-${id}`,
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
  };
}

describe("suggestSavedPlacesOnRoute", () => {
  it("filters by route polyline before running limited detour checks", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          routes: [
            {
              duration: "36000s",
              distanceMeters: 1_000_000,
              polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          routes: [{ duration: "36900s", distanceMeters: 1_018_000 }],
        }),
      );

    const suggestions = await suggestSavedPlacesOnRoute(
      "Portland, OR",
      "San Francisco, CA",
      [
        savedPlace(1, 40.7, -120.95),
        savedPlace(2, 35, -120.95),
        savedPlace(3, 43.252, -126.453),
      ],
      {
        apiKey: "test-key",
        fetchImpl,
        maxDistanceFromRouteMeters: 50_000,
        maxRouteChecks: 1,
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      place: expect.objectContaining({ id: 1 }),
      detourDurationSeconds: 900,
      detourDistanceMeters: 18_000,
    });
  });
});
