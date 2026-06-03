import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    itineraryDay: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    itineraryItem: {
      aggregate: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { addItem, clearDay, deleteDay, deleteItem, getItinerary, updateItem, upsertDay } from "./itinerary";

describe("upsertDay", () => {
  it("upserts by the composite trip/day key and only updates provided fields", async () => {
    prismaMock.itineraryDay.upsert.mockResolvedValueOnce({ id: 1, dayNumber: 2 });
    await upsertDay({ tripId: 3, dayNumber: 2, title: "Hike" });
    const call = prismaMock.itineraryDay.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ tripId_dayNumber: { tripId: 3, dayNumber: 2 } });
    expect(call.update).toEqual({ title: "Hike" });
  });
});

describe("addItem", () => {
  it("appends at the next position after the current max", async () => {
    prismaMock.itineraryDay.upsert.mockResolvedValueOnce({ id: 10, dayNumber: 1 });
    prismaMock.itineraryItem.aggregate.mockResolvedValueOnce({ _max: { position: 2 } });
    prismaMock.itineraryItem.create.mockResolvedValueOnce({ id: 99 });

    await addItem({ tripId: 3, dayNumber: 1, title: "Museum" });

    const data = prismaMock.itineraryItem.create.mock.calls[0][0].data;
    expect(data.dayId).toBe(10);
    expect(data.position).toBe(3);
    expect(data.title).toBe("Museum");
    expect(data.isBackup).toBe(false);
  });

  it("starts at position 0 when the day is empty", async () => {
    prismaMock.itineraryDay.upsert.mockResolvedValueOnce({ id: 11, dayNumber: 1 });
    prismaMock.itineraryItem.aggregate.mockResolvedValueOnce({ _max: { position: null } });
    prismaMock.itineraryItem.create.mockResolvedValueOnce({ id: 1 });

    await addItem({ tripId: 3, dayNumber: 1, title: "First" });
    expect(prismaMock.itineraryItem.create.mock.calls[0][0].data.position).toBe(0);
  });
});

describe("getItinerary", () => {
  it("includes items ordered by position", async () => {
    prismaMock.itineraryDay.findMany.mockResolvedValueOnce([]);
    await getItinerary(3);
    expect(prismaMock.itineraryDay.findMany).toHaveBeenCalledWith({
      where: { tripId: 3 },
      orderBy: { dayNumber: "asc" },
      include: { items: { orderBy: { position: "asc" } } },
    });
  });
});

describe("clearDay", () => {
  it("deletes items for the matching trip/day", async () => {
    prismaMock.itineraryItem.deleteMany.mockResolvedValueOnce({ count: 2 });
    await clearDay(3, 1);
    expect(prismaMock.itineraryItem.deleteMany).toHaveBeenCalledWith({
      where: { day: { tripId: 3, dayNumber: 1 } },
    });
  });
});

describe("updateItem", () => {
  it("returns null when the item is outside the trip", async () => {
    prismaMock.itineraryItem.findFirst.mockResolvedValueOnce(null);
    const result = await updateItem(3, 99, { title: "New" });
    expect(result).toBeNull();
    expect(prismaMock.itineraryItem.update).not.toHaveBeenCalled();
  });

  it("updates only provided fields scoped to the trip", async () => {
    prismaMock.itineraryItem.findFirst.mockResolvedValueOnce({ id: 99 });
    prismaMock.itineraryItem.update.mockResolvedValueOnce({ id: 99, title: "New" });
    await updateItem(3, 99, { title: "New", isBackup: true });
    expect(prismaMock.itineraryItem.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { title: "New", isBackup: true },
    });
  });

  it("moves an item by upserting the target day", async () => {
    prismaMock.itineraryItem.findFirst.mockResolvedValueOnce({ id: 99 });
    prismaMock.itineraryDay.upsert.mockResolvedValueOnce({ id: 12, dayNumber: 2 });
    prismaMock.itineraryItem.update.mockResolvedValueOnce({ id: 99, dayId: 12 });
    await updateItem(3, 99, { dayNumber: 2 });
    expect(prismaMock.itineraryItem.update.mock.calls[0][0].data).toEqual({ dayId: 12 });
  });
});

describe("deleteItem", () => {
  it("deletes only an item in the matching trip", async () => {
    prismaMock.itineraryItem.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(deleteItem(3, 99)).resolves.toBe(true);
    expect(prismaMock.itineraryItem.deleteMany).toHaveBeenCalledWith({
      where: { id: 99, day: { tripId: 3 } },
    });
  });
});

describe("deleteDay", () => {
  it("deletes only the matching trip/day", async () => {
    prismaMock.itineraryDay.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(deleteDay(3, 2)).resolves.toBe(true);
    expect(prismaMock.itineraryDay.deleteMany).toHaveBeenCalledWith({
      where: { tripId: 3, dayNumber: 2 },
    });
  });
});
