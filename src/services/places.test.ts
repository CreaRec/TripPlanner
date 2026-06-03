import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    place: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { addPlace, deletePlace, listPlaces, updatePlace } from "./places";

describe("addPlace", () => {
  it("creates a place with defaulted nullable fields", async () => {
    prismaMock.place.create.mockResolvedValueOnce({ id: 1, name: "Lake" });
    await addPlace({ tripId: 3, name: "Lake", kidFriendly: true });
    const data = prismaMock.place.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tripId: 3,
      name: "Lake",
      kidFriendly: true,
      category: null,
      address: null,
      priority: null,
      durationMin: null,
      notes: null,
    });
  });
});

describe("listPlaces", () => {
  it("orders by priority (nulls last) then created_at", async () => {
    prismaMock.place.findMany.mockResolvedValueOnce([]);
    await listPlaces(3);
    expect(prismaMock.place.findMany).toHaveBeenCalledWith({
      where: { tripId: 3 },
      orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
  });
});

describe("updatePlace", () => {
  it("returns null when the place is outside the trip", async () => {
    prismaMock.place.findFirst.mockResolvedValueOnce(null);
    const result = await updatePlace(3, 9, { name: "Lake" });
    expect(result).toBeNull();
    expect(prismaMock.place.update).not.toHaveBeenCalled();
  });

  it("updates only provided fields scoped to the trip", async () => {
    prismaMock.place.findFirst.mockResolvedValueOnce({ id: 9 });
    prismaMock.place.update.mockResolvedValueOnce({ id: 9, name: "Lake" });
    await updatePlace(3, 9, { name: "Lake", priority: 1 });
    expect(prismaMock.place.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { name: "Lake", priority: 1 },
    });
  });
});

describe("deletePlace", () => {
  it("deletes only a place in the matching trip", async () => {
    prismaMock.place.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(deletePlace(3, 9)).resolves.toBe(true);
    expect(prismaMock.place.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, tripId: 3 },
    });
  });
});
