import type { Trip } from "@prisma/client";
import { prisma } from "../db/prisma";
import { toDate } from "../util";

export interface CreateTripInput {
  telegramId: number;
  title: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelers?: string | null;
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  return prisma.trip.create({
    data: {
      telegramId: BigInt(input.telegramId),
      title: input.title,
      destination: input.destination ?? null,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      travelers: input.travelers ?? null,
    },
  });
}

export async function listTrips(telegramId: number): Promise<Trip[]> {
  return prisma.trip.findMany({
    where: { telegramId: BigInt(telegramId) },
    orderBy: { createdAt: "desc" },
  });
}

export async function getTrip(telegramId: number, tripId: number): Promise<Trip | null> {
  return prisma.trip.findFirst({
    where: { id: tripId, telegramId: BigInt(telegramId) },
  });
}

export interface UpdateTripFields {
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  travelers?: string | null;
  summary?: string | null;
}

export async function updateTrip(
  telegramId: number,
  tripId: number,
  fields: UpdateTripFields,
): Promise<Trip | null> {
  const trip = await getTrip(telegramId, tripId);
  if (!trip) return null;

  return prisma.trip.update({
    where: { id: tripId },
    data: {
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.destination !== undefined ? { destination: fields.destination } : {}),
      ...(fields.startDate !== undefined ? { startDate: toDate(fields.startDate) } : {}),
      ...(fields.endDate !== undefined ? { endDate: toDate(fields.endDate) } : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.travelers !== undefined ? { travelers: fields.travelers } : {}),
      ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
    },
  });
}

export async function deleteTrip(telegramId: number, tripId: number): Promise<boolean> {
  const trip = await getTrip(telegramId, tripId);
  if (!trip) return false;

  await prisma.trip.delete({ where: { id: tripId } });
  return true;
}
