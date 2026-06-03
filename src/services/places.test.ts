import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { place: { create: vi.fn(), findMany: vi.fn() } },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { addPlace, listPlaces } from "./places";

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
