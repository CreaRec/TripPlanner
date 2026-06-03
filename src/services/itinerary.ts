import type { ItineraryDay, ItineraryItem } from "@prisma/client";
import { prisma } from "../db/prisma";
import { toDate } from "../util";

export interface UpsertDayInput {
  tripId: number;
  dayNumber: number;
  date?: string | null;
  title?: string | null;
  summary?: string | null;
}

export async function upsertDay(input: UpsertDayInput): Promise<ItineraryDay> {
  const update: Record<string, unknown> = {};
  if (input.date !== undefined && input.date !== null) update.date = toDate(input.date);
  if (input.title !== undefined && input.title !== null) update.title = input.title;
  if (input.summary !== undefined && input.summary !== null) update.summary = input.summary;

  return prisma.itineraryDay.upsert({
    where: { tripId_dayNumber: { tripId: input.tripId, dayNumber: input.dayNumber } },
    create: {
      tripId: input.tripId,
      dayNumber: input.dayNumber,
      date: toDate(input.date),
      title: input.title ?? null,
      summary: input.summary ?? null,
    },
    update,
  });
}

export interface AddItemInput {
  tripId: number;
  dayNumber: number;
  title: string;
  timeBlock?: string | null;
  notes?: string | null;
  placeId?: number | null;
  isBackup?: boolean;
}

export async function addItem(input: AddItemInput): Promise<ItineraryItem> {
  const day = await upsertDay({ tripId: input.tripId, dayNumber: input.dayNumber });
  const agg = await prisma.itineraryItem.aggregate({
    where: { dayId: day.id },
    _max: { position: true },
  });
  const position = (agg._max.position ?? -1) + 1;

  return prisma.itineraryItem.create({
    data: {
      dayId: day.id,
      placeId: input.placeId ?? null,
      position,
      title: input.title,
      timeBlock: input.timeBlock ?? null,
      notes: input.notes ?? null,
      isBackup: input.isBackup ?? false,
    },
  });
}

export type ItineraryDayWithItems = ItineraryDay & { items: ItineraryItem[] };

export async function getItinerary(tripId: number): Promise<ItineraryDayWithItems[]> {
  return prisma.itineraryDay.findMany({
    where: { tripId },
    orderBy: { dayNumber: "asc" },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

export async function clearDay(tripId: number, dayNumber: number): Promise<void> {
  await prisma.itineraryItem.deleteMany({
    where: { day: { tripId, dayNumber } },
  });
}
