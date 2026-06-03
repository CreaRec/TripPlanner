import { describe, expect, it } from "vitest";
import { decodeEncodedPolyline, distanceToPolylineMeters } from "./routeGeometry";

describe("routeGeometry", () => {
  it("decodes an encoded Google polyline", () => {
    const points = decodeEncodedPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

    expect(points).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it("calculates distance from a point to a route polyline", () => {
    const route = decodeEncodedPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

    expect(distanceToPolylineMeters({ latitude: 40.7, longitude: -120.95 }, route)).toBeLessThan(1);
    expect(distanceToPolylineMeters({ latitude: 35, longitude: -120.95 }, route)).toBeGreaterThan(300_000);
  });
});
