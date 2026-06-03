import { describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    reservation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma", () => ({ prisma: prismaMock }));

import { addReservation, deleteReservation, listReservations, updateReservation } from "./reservations";

describe("addReservation", () => {
  it("creates a reservation with defaulted nullable fields and metadata", async () => {
    prismaMock.reservation.create.mockResolvedValueOnce({ id: 1, title: "Hotel" });
    await addReservation({
      tripId: 3,
      type: "hotel",
      title: "Hotel",
      startAt: "2026-07-01T15:00:00Z",
      metadata: { source: "test" },
    });

    const data = prismaMock.reservation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tripId: 3,
      type: "hotel",
      title: "Hotel",
      provider: null,
      confirmationNumber: null,
      address: null,
      status: null,
      notes: null,
      metadata: { source: "test" },
    });
    expect(data.startAt?.toISOString()).toBe("2026-07-01T15:00:00.000Z");
    expect(data.endAt).toBeNull();
  });

  it("falls back to an empty metadata object", async () => {
    prismaMock.reservation.create.mockResolvedValueOnce({ id: 2, title: "Car" });
    await addReservation({ tripId: 3, type: "car_rental", title: "Car" });
    expect(prismaMock.reservation.create.mock.calls[0][0].data.metadata).toEqual({});
  });
});

describe("listReservations", () => {
  it("orders by start time (nulls last) then created_at", async () => {
    prismaMock.reservation.findMany.mockResolvedValueOnce([]);
    await listReservations(3);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith({
      where: { tripId: 3 },
      orderBy: [{ startAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
  });
});

describe("updateReservation", () => {
  it("returns null when the reservation is outside the trip", async () => {
    prismaMock.reservation.findFirst.mockResolvedValueOnce(null);
    const result = await updateReservation(3, 9, { title: "New" });
    expect(result).toBeNull();
    expect(prismaMock.reservation.update).not.toHaveBeenCalled();
  });

  it("updates only provided fields scoped to the trip", async () => {
    prismaMock.reservation.findFirst.mockResolvedValueOnce({ id: 9 });
    prismaMock.reservation.update.mockResolvedValueOnce({ id: 9, title: "New" });
    await updateReservation(3, 9, { title: "New", startAt: "2026-07-02T10:00:00Z" });
    const call = prismaMock.reservation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 9 });
    expect(call.data.title).toBe("New");
    expect(call.data.startAt.toISOString()).toBe("2026-07-02T10:00:00.000Z");
  });
});

describe("deleteReservation", () => {
  it("deletes only a reservation in the matching trip", async () => {
    prismaMock.reservation.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(deleteReservation(3, 9)).resolves.toBe(true);
    expect(prismaMock.reservation.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, tripId: 3 },
    });
  });
});
