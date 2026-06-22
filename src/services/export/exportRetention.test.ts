import { describe, expect, it } from "vitest";
import { selectObjectsForRetention } from "./exportRetention";

describe("selectObjectsForRetention", () => {
  const now = new Date("2026-06-05T12:00:00Z");

  it("deletes objects older than max age", () => {
    const objects = [
      { key: "old", size: 100, lastModified: new Date("2026-04-01T00:00:00Z") },
      { key: "fresh", size: 200, lastModified: new Date("2026-06-01T00:00:00Z") },
    ];

    const result = selectObjectsForRetention(objects, {
      maxAgeDays: 30,
      maxBytes: 10_000,
      now,
    });

    expect(result.toDelete).toEqual(["old"]);
    expect(result.ageDeleted).toBe(1);
    expect(result.remaining.map((obj) => obj.key)).toEqual(["fresh"]);
  });

  it("deletes oldest objects when total size exceeds the cap", () => {
    const objects = [
      { key: "a", size: 2_000_000_000, lastModified: new Date("2026-05-01T00:00:00Z") },
      { key: "b", size: 2_000_000_000, lastModified: new Date("2026-05-15T00:00:00Z") },
      { key: "c", size: 1_000_000_000, lastModified: new Date("2026-06-01T00:00:00Z") },
    ];

    const result = selectObjectsForRetention(objects, {
      maxAgeDays: 365,
      maxBytes: 4_000_000_000,
      now,
    });

    expect(result.toDelete).toEqual(["a"]);
    expect(result.sizeDeleted).toBe(1);
    expect(result.remaining.map((obj) => obj.key)).toEqual(["b", "c"]);
  });
});
