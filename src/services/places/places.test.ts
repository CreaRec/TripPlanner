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

vi.mock("../../db/prisma", () => ({ prisma: prismaMock }));

import { addPlace, deletePlace, findPlaceByExternalId, getPlace, listPlaces, updatePlace } from "./places";

describe("addPlace", () => {
  it("creates a place with defaulted fields", async () => {
    prismaMock.place.create.mockResolvedValueOnce({ id: 1, name: "Lake" });
    await addPlace({ tripId: 3, name: "Lake", kidFriendly: true });
    const data = prismaMock.place.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tripId: 3,
      name: "Lake",
      kidFriendly: true,
      category: "other",
      address: null,
      priority: null,
      durationMin: null,
      notes: null,
    });
  });

  it("creates a place with a supported category", async () => {
    prismaMock.place.create.mockResolvedValueOnce({ id: 2, name: "Bistro" });
    await addPlace({ tripId: 3, name: "Bistro", category: "restaurant" });
    const data = prismaMock.place.create.mock.calls.at(-1)?.[0].data;
    expect(data).toMatchObject({
      tripId: 3,
      name: "Bistro",
      category: "restaurant",
    });
  });

  it("creates a place with enrichment fields", async () => {
    prismaMock.place.create.mockResolvedValueOnce({ id: 3, name: "Louvre" });
    await addPlace({
      tripId: 3,
      name: "Louvre",
      category: "museum",
      externalProvider: "google_places",
      externalId: "abc",
      latitude: 48.8606,
      longitude: 2.3376,
      websiteUrl: "https://www.louvre.fr",
      mapsUrl: "https://maps.google.com/?cid=abc",
      reservationRecommended: true,
      ticketUrl: "https://www.louvre.fr",
      rating: 4.7,
      priceLevel: 2,
    });
    const data = prismaMock.place.create.mock.calls.at(-1)?.[0].data;
    expect(data).toMatchObject({
      tripId: 3,
      name: "Louvre",
      category: "museum",
      externalProvider: "google_places",
      externalId: "abc",
      latitude: 48.8606,
      longitude: 2.3376,
      websiteUrl: "https://www.louvre.fr",
      mapsUrl: "https://maps.google.com/?cid=abc",
      reservationRecommended: true,
      ticketUrl: "https://www.louvre.fr",
      rating: 4.7,
      priceLevel: 2,
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
    await updatePlace(3, 9, { name: "Lake", category: "museum", priority: 1 });
    expect(prismaMock.place.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { name: "Lake", category: "museum", priority: 1 },
    });
  });

  it("updates a null category to other", async () => {
    prismaMock.place.findFirst.mockResolvedValueOnce({ id: 9 });
    prismaMock.place.update.mockResolvedValueOnce({ id: 9, name: "Lake" });
    await updatePlace(3, 9, { category: null });
    expect(prismaMock.place.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { category: "other" },
    });
  });
});

describe("getPlace", () => {
  it("reads a place scoped to the trip", async () => {
    prismaMock.place.findFirst.mockResolvedValueOnce({ id: 9, tripId: 3 });
    await getPlace(3, 9);
    expect(prismaMock.place.findFirst).toHaveBeenCalledWith({
      where: { id: 9, tripId: 3 },
    });
  });
});

describe("findPlaceByExternalId", () => {
  it("reads a place by external provider and id scoped to the trip", async () => {
    prismaMock.place.findFirst.mockResolvedValueOnce({ id: 9, tripId: 3 });
    await findPlaceByExternalId(3, "google_places", "abc");
    expect(prismaMock.place.findFirst).toHaveBeenCalledWith({
      where: { tripId: 3, externalProvider: "google_places", externalId: "abc" },
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
