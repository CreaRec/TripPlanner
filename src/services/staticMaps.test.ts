import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRouteComparisonStaticMapUrl, generateRouteComparisonMap } from "./staticMaps";
import { encodePolyline } from "./routeGeometry";

const input = {
  origin: "Austin, TX",
  destination: "Moab, UT",
  stopName: "Urban Hill",
  startLocation: { latitude: 30.2672, longitude: -97.7431 },
  stopLocation: { latitude: 40.7608, longitude: -111.891 },
  endLocation: { latitude: 38.5733, longitude: -109.5498 },
  baseEncodedPolyline: "base-polyline",
  detourEncodedPolyline: "detour-polyline",
  detourDurationSeconds: 240,
  detourDistanceMeters: 3200,
  apiKey: "test-key",
};

describe("staticMaps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a Static Maps URL with base and detour paths", () => {
    const url = new URL(buildRouteComparisonStaticMapUrl(input));

    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/staticmap");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.getAll("path")).toEqual([
      "color:0x0066ffff|weight:6|enc:detour-polyline",
      "color:0xff6600ff|weight:4|enc:base-polyline",
    ]);
    expect(url.searchParams.getAll("markers")).toEqual([
      "color:green|label:A|30.2672,-97.7431",
      "color:blue|label:B|40.7608,-111.891",
      "color:red|label:C|38.5733,-109.5498",
    ]);
  });

  it("downloads and saves a PNG file", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const png = Buffer.from("png");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(png, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );

    const file = await generateRouteComparisonMap({
      ...input,
      fetchImpl,
      filenamePrefix: "urban-hill-map",
    });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("maps.googleapis.com/maps/api/staticmap"));
    expect(file).toContain("urban-hill-map-123.png");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file)).toEqual(png);
  });

  it("simplifies long polylines to avoid oversized Static Maps URLs", () => {
    const longPolyline = encodePolyline(
      Array.from({ length: 2000 }, (_, index) => ({
        latitude: 30 + index * 0.001,
        longitude: -97 + Math.sin(index / 10) * 0.01,
      })),
    );

    const url = buildRouteComparisonStaticMapUrl({
      ...input,
      baseEncodedPolyline: longPolyline,
      detourEncodedPolyline: longPolyline,
    });

    expect(url.length).toBeLessThanOrEqual(15_000);
  });
});
