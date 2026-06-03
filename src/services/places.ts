import type { Place } from "@prisma/client";
import { prisma } from "../db/prisma";

export const PLACE_CATEGORIES = [
  "restaurant",
  "museum",
  "natural_attraction",
  "national_park",
  "tour",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];
export const DEFAULT_PLACE_CATEGORY: PlaceCategory = "other";

export interface AddPlaceInput {
  tripId: number;
  name: string;
  category?: PlaceCategory | null;
  address?: string | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
  notes?: string | null;
}

export interface UpdatePlaceFields {
  name?: string;
  category?: PlaceCategory | null;
  address?: string | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
  notes?: string | null;
}

export async function addPlace(input: AddPlaceInput): Promise<Place> {
  return prisma.place.create({
    data: {
      tripId: input.tripId,
      name: input.name,
      category: input.category ?? DEFAULT_PLACE_CATEGORY,
      address: input.address ?? null,
      priority: input.priority ?? null,
      durationMin: input.durationMin ?? null,
      kidFriendly: input.kidFriendly ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function listPlaces(tripId: number): Promise<Place[]> {
  return prisma.place.findMany({
    where: { tripId },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

export async function updatePlace(
  tripId: number,
  placeId: number,
  fields: UpdatePlaceFields,
): Promise<Place | null> {
  const place = await prisma.place.findFirst({
    where: { id: placeId, tripId },
  });
  if (!place) return null;

  return prisma.place.update({
    where: { id: placeId },
    data: {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.category !== undefined ? { category: fields.category ?? DEFAULT_PLACE_CATEGORY } : {}),
      ...(fields.address !== undefined ? { address: fields.address } : {}),
      ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
      ...(fields.durationMin !== undefined ? { durationMin: fields.durationMin } : {}),
      ...(fields.kidFriendly !== undefined ? { kidFriendly: fields.kidFriendly } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    },
  });
}

export async function deletePlace(tripId: number, placeId: number): Promise<boolean> {
  const result = await prisma.place.deleteMany({
    where: { id: placeId, tripId },
  });
  return result.count > 0;
}
