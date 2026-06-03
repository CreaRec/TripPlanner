import type { Place } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AddPlaceInput {
  tripId: number;
  name: string;
  category?: string | null;
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
      category: input.category ?? null,
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
