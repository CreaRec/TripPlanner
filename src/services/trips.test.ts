import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    trip: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { createTrip, deleteTrip, getTrip, listTrips, updateTrip } from "./trips";

describe("createTrip", () => {
  it("creates a trip with BigInt owner id and parsed dates", async () => {
    prismaMock.trip.create.mockResolvedValueOnce({ id: 1, title: "Trip" });
    await createTrip({
      telegramId: 111,
      title: "Trip",
      destination: "Bavaria",
      startDate: "2026-07-01",
      endDate: null,
    });
    const data = prismaMock.trip.create.mock.calls[0][0].data;
    expect(data.telegramId).toBe(111n);
    expect(data.title).toBe("Trip");
    expect(data.destination).toBe("Bavaria");
    expect(data.startDate?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(data.endDate).toBeNull();
  });
});

describe("listTrips", () => {
  it("queries by owner ordered by newest first", async () => {
    prismaMock.trip.findMany.mockResolvedValueOnce([]);
    await listTrips(111);
    expect(prismaMock.trip.findMany).toHaveBeenCalledWith({
      where: { telegramId: 111n },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("getTrip", () => {
  it("scopes the lookup to the owner", async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: 5 });
    const trip = await getTrip(111, 5);
    expect(trip).toEqual({ id: 5 });
    expect(prismaMock.trip.findFirst).toHaveBeenCalledWith({
      where: { id: 5, telegramId: 111n },
    });
  });
});

describe("updateTrip", () => {
  it("returns null when the trip is not owned by the user", async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null);
    const result = await updateTrip(111, 5, { title: "x" });
    expect(result).toBeNull();
    expect(prismaMock.trip.update).not.toHaveBeenCalled();
  });

  it("only updates the provided fields", async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: 5 });
    prismaMock.trip.update.mockResolvedValueOnce({ id: 5, summary: "done" });
    await updateTrip(111, 5, { summary: "done" });
    expect(prismaMock.trip.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { summary: "done" },
    });
  });
});

describe("deleteTrip", () => {
  it("returns false when the trip is not owned by the user", async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null);
    const result = await deleteTrip(111, 5);
    expect(result).toBe(false);
    expect(prismaMock.trip.delete).not.toHaveBeenCalled();
  });

  it("deletes an owned trip", async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: 5 });
    prismaMock.trip.delete.mockResolvedValueOnce({ id: 5 });
    await expect(deleteTrip(111, 5)).resolves.toBe(true);
    expect(prismaMock.trip.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
