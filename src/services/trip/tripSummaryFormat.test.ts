import { describe, expect, it } from "vitest";
import type { Reservation, Trip } from "@prisma/client";
import { dedupeReservations, formatDateRange, formatTripSummary } from "./tripSummaryFormat";
import type { ItineraryDayWithItems } from "./itinerary";

const baseTrip: Trip = {
  id: 1,
  telegramId: BigInt(111),
  title: "Сиэтл",
  destination: "Seattle → Moses Lake (work)",
  startDate: new Date("2026-07-13T00:00:00.000Z"),
  endDate: new Date("2026-07-20T00:00:00.000Z"),
  status: "planning",
  travelers: "Rimma и Vasilisa",
  summary: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const reservations: Reservation[] = [
  {
    id: 1,
    tripId: 1,
    type: "flight",
    title: "AUS → SEA",
    provider: "Alaska AS 215",
    confirmationNumber: "FLFLOD",
    startAt: new Date("2026-07-13T14:00:00.000Z"),
    endAt: null,
    address: null,
    status: "booked",
    notes: null,
    metadata: { seat: "17B" },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    tripId: 1,
    type: "car_rental",
    title: "Seattle-Tacoma (SEA)",
    provider: "Hertz",
    confirmationNumber: null,
    startAt: new Date("2026-07-13T10:00:00.000Z"),
    endAt: new Date("2026-07-20T18:00:00.000Z"),
    address: null,
    status: "booked",
    notes: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 3,
    tripId: 1,
    type: "hotel",
    title: "Hyatt Regency Seattle",
    provider: null,
    confirmationNumber: "2155953",
    startAt: new Date("2026-07-18T15:00:00.000Z"),
    endAt: new Date("2026-07-20T11:00:00.000Z"),
    address: "808 Howell Street, Seattle, WA 98101",
    status: "booked",
    notes: "2 Queen Beds, 2 adults + 1 child",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 4,
    tripId: 1,
    type: "flight",
    title: "SEA → AUS",
    provider: "Alaska AS 604",
    confirmationNumber: "FLFLOD",
    startAt: new Date("2026-07-20T16:00:00.000Z"),
    endAt: null,
    address: null,
    status: "booked",
    notes: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const itinerary: ItineraryDayWithItems[] = [
  {
    id: 1,
    tripId: 1,
    dayNumber: 1,
    date: new Date("2026-07-13T00:00:00.000Z"),
    title: "Seattle → Moses Lake (work)",
    summary: null,
    items: [],
  },
  {
    id: 2,
    tripId: 1,
    dayNumber: 6,
    date: new Date("2026-07-18T00:00:00.000Z"),
    title: "Seattle",
    summary: null,
    items: [
      {
        id: 10,
        dayId: 2,
        placeId: null,
        position: 0,
        title: "The Museum of Flight",
        timeBlock: "Sat",
        notes: null,
        isBackup: false,
      },
    ],
  },
];

describe("dedupeReservations", () => {
  it("merges duplicate flight records saved multiple times", () => {
    const duplicateFlights: Reservation[] = [
      {
        id: 1,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 215 — Austin to Seattle",
        provider: "Alaska Airlines",
        confirmationNumber: "FLFLOD",
        startAt: new Date("2026-07-13T14:00:00.000Z"),
        endAt: null,
        address: null,
        status: "booked",
        notes: null,
        metadata: { seat: "17B" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 215",
        provider: "Alaska Airlines",
        confirmationNumber: "FLFLOD",
        startAt: new Date("2026-07-13T14:00:00.000Z"),
        endAt: null,
        address: null,
        status: "booked",
        notes: null,
        metadata: { seat: "17B" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 3,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 215 — Austin to Seattle",
        provider: "Alaska Airlines",
        confirmationNumber: "HBWBWR",
        startAt: new Date("2026-07-17T14:00:00.000Z"),
        endAt: null,
        address: null,
        status: "booked",
        notes: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 4,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 604",
        provider: "Alaska Airlines",
        confirmationNumber: "FLFLOD",
        startAt: new Date("2026-07-20T16:00:00.000Z"),
        endAt: null,
        address: null,
        status: "booked",
        notes: null,
        metadata: { seat: "17B" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 5,
        tripId: 1,
        type: "flight",
        title: "Alaska Airlines AS 604 — Seattle to Austin",
        provider: "Alaska Airlines",
        confirmationNumber: "HBWBWR",
        startAt: new Date("2026-07-20T16:00:00.000Z"),
        endAt: null,
        address: null,
        status: "booked",
        notes: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const deduped = dedupeReservations(duplicateFlights);
    expect(deduped).toHaveLength(2);
    expect(flightCodes(deduped)).toEqual(["AS215", "AS604"]);
  });

  it("hides duplicate flight notes in the card summary", () => {
    const text = formatTripSummary({
      trip: baseTrip,
      itinerary,
      reservations: [
        reservations[0],
        {
          ...reservations[0],
          id: 99,
          title: "Alaska Airlines AS 215",
          confirmationNumber: "FLFLOD",
        },
        reservations[3],
        {
          ...reservations[3],
          id: 100,
          title: "Alaska Airlines AS 604 — Seattle to Austin",
          confirmationNumber: "HBWBWR",
        },
      ],
      memories: [
        { content: "Рейс AS 215 — Austin to Seattle, 13 июля 2026" },
        { content: "Рейс AS 604 — Seattle to Austin, 20 июля 2026" },
        { content: "The Museum of Flight на субботу" },
      ],
      format: "card",
      locale: "ru",
    });

    expect(text.match(/AS 215/g)?.length ?? 0).toBe(1);
    expect(text.match(/AS 604/g)?.length ?? 0).toBe(1);
    expect(text).toContain("The Museum of Flight на субботу");
    expect(text).not.toContain("Рейс AS 215");
    expect(text).not.toContain("Рейс AS 604");
  });
});

function flightCodes(items: Reservation[]): string[] {
  return items
    .map((item) => {
      const match = `${item.provider ?? ""} ${item.title}`.match(/\b([A-Z0-9]{2})\s*(\d{1,4})\b/i);
      return match ? `${match[1].toUpperCase()}${match[2]}` : null;
    })
    .filter((value): value is string => value !== null);
}

describe("formatDateRange", () => {
  it("formats same-month ranges in Russian", () => {
    expect(formatDateRange("2026-07-13", "2026-07-20", "ru")).toBe("13–20 июля 2026");
  });

  it("formats same-month ranges in English", () => {
    expect(formatDateRange("2026-07-13", "2026-07-20", "en")).toBe("Jul 13–20, 2026");
  });
});

describe("formatTripSummary card", () => {
  it("renders a structured trip card in Russian", () => {
    const text = formatTripSummary({
      trip: baseTrip,
      itinerary,
      reservations,
      memories: [
        { content: "на рейсе есть seat 17B" },
        { content: "для отеля сохранены 2 Queen Beds, 2 adults + 1 child" },
      ],
      format: "card",
      locale: "ru",
    });

    expect(text).toContain("🗓 13–20 июля 2026 · Rimma и Vasilisa");
    expect(text).toContain("📍 Seattle → Moses Lake (work)");
    expect(text).toContain("✈️ Транспорт");
    expect(text).toContain("Alaska AS 215");
    expect(text).toContain("seat 17B");
    expect(text).toContain("🏨 Отель");
    expect(text).toContain("Hyatt Regency Seattle");
    expect(text).toContain("808 Howell Street");
    expect(text).toContain("📋 План");
    expect(text).toContain("Day 1 — Seattle → Moses Lake (work)");
    expect(text).toContain("The Museum of Flight");
    expect(text).toContain("📝 Важные заметки");
  });
});

describe("formatTripSummary by_day", () => {
  it("renders day-by-day view with reservations and activities", () => {
    const text = formatTripSummary({
      trip: baseTrip,
      itinerary,
      reservations,
      format: "by_day",
      locale: "ru",
    });

    expect(text).toContain("📅 Day 1 · 13 июля · Seattle → Moses Lake (work)");
    expect(text).toContain("Alaska AS 215");
    expect(text).toContain("Seattle-Tacoma (SEA) · получение");
    expect(text).toContain("📅 Day 6 · 18 июля · Seattle");
    expect(text).toContain("Hyatt Regency Seattle · заезд");
    expect(text).toContain("The Museum of Flight");
    expect(text).toContain("📅 20 июля 2026");
    expect(text).toContain("выезд");
    expect(text).toContain("Alaska AS 604");
    expect(text).toContain("возврат");
  });
});
