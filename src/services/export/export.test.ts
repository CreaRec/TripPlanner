import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const { tmp, getItineraryMock, listPlacesMock } = vi.hoisted(() => {
  // require (not import) because hoisted factories run before import bindings init.
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  return {
    tmp: fs.mkdtempSync(path.join(os.tmpdir(), "trip-export-")),
    getItineraryMock: vi.fn(),
    listPlacesMock: vi.fn(),
  };
});

vi.mock("../../config", () => ({ config: { dataDir: tmp }, isExportStorageConfigured: () => false }));
vi.mock("../trip/itinerary", () => ({ getItinerary: getItineraryMock }));
vi.mock("../places/places", () => ({ listPlaces: listPlacesMock }));

import { exportItineraryCsv, exportItineraryPdf, computeItineraryExportFingerprint } from "./export";

const trip = {
  id: 7,
  title: "Family Roadtrip",
  destination: "Bavaria",
  startDate: new Date("2026-07-01T00:00:00Z"),
  endDate: new Date("2026-07-05T00:00:00Z"),
  travelers: "2 adults, 1 child (7)",
  summary: "Scenic, kid-friendly.",
} as never;

const itinerary = [
  {
    id: 1,
    tripId: 7,
    dayNumber: 1,
    date: new Date("2026-07-01T00:00:00Z"),
    title: "Arrival",
    summary: "Easy day",
    items: [
      { id: 1, position: 0, title: "Hotel check-in", timeBlock: "15:00", notes: "Near, kid-friendly", isBackup: false },
      { id: 2, position: 1, title: "Rainy-day museum", timeBlock: null, notes: null, isBackup: true },
    ],
  },
];

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("exportItineraryCsv", () => {
  it("writes a CSV with a header, escaped cells, and one row per item", async () => {
    getItineraryMock.mockResolvedValue(itinerary);
    listPlacesMock.mockResolvedValue([]);

    const file = await exportItineraryCsv(trip);
    expect(file.path).toBe(join(tmp, "family-roadtrip-7.csv"));
    expect(file.cached).toBe(false);

    const content = readFileSync(file.path, "utf8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("day_number,date,day_title,position,time_block,item,is_backup,notes");
    expect(lines[1]).toContain('"Near, kid-friendly"'); // comma triggers quoting
    expect(lines[2]).toContain("Rainy-day museum");
    expect(lines[2].endsWith(",")).toBe(true); // empty trailing notes
  });

  it("emits a single row for an empty day", async () => {
    getItineraryMock.mockResolvedValue([
      { id: 9, dayNumber: 2, date: null, title: "Free day", summary: "Relax", items: [] },
    ]);
    listPlacesMock.mockResolvedValue([]);
    const file = await exportItineraryCsv(trip);
    const lines = readFileSync(file.path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("exportItineraryPdf", () => {
  it("generates a non-empty PDF file", async () => {
    getItineraryMock.mockResolvedValue(itinerary);
    listPlacesMock.mockResolvedValue([
      { id: 1, name: "Scenic viewpoint", category: "nature", kidFriendly: true, notes: "Short walk" },
    ]);

    const file = await exportItineraryPdf(trip);
    expect(file.path).toBe(join(tmp, "family-roadtrip-7.pdf"));
    expect(file.cached).toBe(false);
    expect(statSync(file.path).size).toBeGreaterThan(0);
  });
});

describe("computeItineraryExportFingerprint", () => {
  it("returns the same hash for identical export data", () => {
    const places = [
      { id: 1, name: "Scenic viewpoint", category: "natural_attraction", address: null, kidFriendly: true, notes: "Short walk" },
    ] as never;
    const first = computeItineraryExportFingerprint(trip, itinerary, places, "pdf");
    const second = computeItineraryExportFingerprint(trip, itinerary, places, "pdf");
    expect(first).toBe(second);
  });

  it("changes when itinerary items change", () => {
    const places = [] as never;
    const before = computeItineraryExportFingerprint(trip, itinerary, places, "csv");
    const changed = computeItineraryExportFingerprint(
      trip,
      [
        {
          ...itinerary[0]!,
          items: [...itinerary[0]!.items, { id: 3, position: 2, title: "Dinner", timeBlock: "19:00", notes: null, isBackup: false }],
        },
      ],
      places,
      "csv",
    );
    expect(before).not.toBe(changed);
  });
});
