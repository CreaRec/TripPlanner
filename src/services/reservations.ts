import type { Prisma, Reservation } from "@prisma/client";
import { prisma } from "../db/prisma";

export type ReservationType = "hotel" | "car_rental" | "flight" | "campsite" | "other";

export interface AddReservationInput {
  tripId: number;
  type: ReservationType | string;
  title: string;
  provider?: string | null;
  confirmationNumber?: string | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  address?: string | null;
  status?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateReservationFields {
  type?: ReservationType | string;
  title?: string;
  provider?: string | null;
  confirmationNumber?: string | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  address?: string | null;
  status?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
}

function toDateTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function addReservation(input: AddReservationInput): Promise<Reservation> {
  return prisma.reservation.create({
    data: {
      tripId: input.tripId,
      type: String(input.type),
      title: input.title,
      provider: input.provider ?? null,
      confirmationNumber: input.confirmationNumber ?? null,
      startAt: toDateTime(input.startAt),
      endAt: toDateTime(input.endAt),
      address: input.address ?? null,
      status: input.status ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    },
  });
}

export async function listReservations(tripId: number): Promise<Reservation[]> {
  return prisma.reservation.findMany({
    where: { tripId },
    orderBy: [{ startAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

export async function getReservation(tripId: number, reservationId: number): Promise<Reservation | null> {
  return prisma.reservation.findFirst({
    where: { id: reservationId, tripId },
  });
}

export async function updateReservation(
  tripId: number,
  reservationId: number,
  fields: UpdateReservationFields,
): Promise<Reservation | null> {
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, tripId },
  });
  if (!reservation) return null;

  return prisma.reservation.update({
    where: { id: reservationId },
    data: {
      ...(fields.type !== undefined ? { type: String(fields.type) } : {}),
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.provider !== undefined ? { provider: fields.provider } : {}),
      ...(fields.confirmationNumber !== undefined
        ? { confirmationNumber: fields.confirmationNumber }
        : {}),
      ...(fields.startAt !== undefined ? { startAt: toDateTime(fields.startAt) } : {}),
      ...(fields.endAt !== undefined ? { endAt: toDateTime(fields.endAt) } : {}),
      ...(fields.address !== undefined ? { address: fields.address } : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.metadata !== undefined ? { metadata: fields.metadata } : {}),
    },
  });
}

export async function deleteReservation(
  tripId: number,
  reservationId: number,
): Promise<boolean> {
  const result = await prisma.reservation.deleteMany({
    where: { id: reservationId, tripId },
  });
  return result.count > 0;
}
