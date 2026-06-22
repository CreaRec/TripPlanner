import { PlaceCategory, Prisma, type Place as PrismaPlace } from "@prisma/client";
import { prisma } from "../../db/prisma";

export { PlaceCategory };
export const PLACE_CATEGORIES: PlaceCategory[] = Object.values(PlaceCategory);
export const DEFAULT_PLACE_CATEGORY = PlaceCategory.other;

export type Place = PrismaPlace & {
  externalProvider: string | null;
  externalId: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  phone: string | null;
  bookingUrl: string | null;
  ticketUrl: string | null;
  reservationRecommended: boolean;
  openingHours: Prisma.JsonValue | null;
  rating: number | null;
  priceLevel: number | null;
};

export interface AddPlaceInput {
  tripId: number;
  name: string;
  category?: PlaceCategory | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalProvider?: string | null;
  externalId?: string | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
  phone?: string | null;
  bookingUrl?: string | null;
  ticketUrl?: string | null;
  reservationRecommended?: boolean | null;
  openingHours?: Prisma.InputJsonValue | null;
  rating?: number | null;
  priceLevel?: number | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
  notes?: string | null;
}

export interface UpdatePlaceFields {
  name?: string;
  category?: PlaceCategory | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalProvider?: string | null;
  externalId?: string | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
  phone?: string | null;
  bookingUrl?: string | null;
  ticketUrl?: string | null;
  reservationRecommended?: boolean | null;
  openingHours?: Prisma.InputJsonValue | null;
  rating?: number | null;
  priceLevel?: number | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
  notes?: string | null;
}

function jsonOrDbNull(value: Prisma.InputJsonValue | null | undefined): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value ?? Prisma.DbNull;
}

export async function addPlace(input: AddPlaceInput): Promise<Place> {
  const data = {
    tripId: input.tripId,
    name: input.name,
    category: input.category ?? DEFAULT_PLACE_CATEGORY,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    externalProvider: input.externalProvider ?? null,
    externalId: input.externalId ?? null,
    websiteUrl: input.websiteUrl ?? null,
    mapsUrl: input.mapsUrl ?? null,
    phone: input.phone ?? null,
    bookingUrl: input.bookingUrl ?? null,
    ticketUrl: input.ticketUrl ?? null,
    reservationRecommended: input.reservationRecommended ?? false,
    openingHours: jsonOrDbNull(input.openingHours),
    rating: input.rating ?? null,
    priceLevel: input.priceLevel ?? null,
    priority: input.priority ?? null,
    durationMin: input.durationMin ?? null,
    kidFriendly: input.kidFriendly ?? null,
    notes: input.notes ?? null,
  };
  return (prisma.place.create({
    data: data as Prisma.PlaceUncheckedCreateInput,
  }) as unknown) as Promise<Place>;
}

export async function listPlaces(tripId: number): Promise<Place[]> {
  return prisma.place.findMany({
    where: { tripId },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  }) as Promise<Place[]>;
}

export async function getPlace(tripId: number, placeId: number): Promise<Place | null> {
  return prisma.place.findFirst({
    where: { id: placeId, tripId },
  }) as Promise<Place | null>;
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

  return (prisma.place.update({
    where: { id: placeId },
    data: {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.category !== undefined ? { category: fields.category ?? DEFAULT_PLACE_CATEGORY } : {}),
      ...(fields.address !== undefined ? { address: fields.address } : {}),
      ...(fields.latitude !== undefined ? { latitude: fields.latitude } : {}),
      ...(fields.longitude !== undefined ? { longitude: fields.longitude } : {}),
      ...(fields.externalProvider !== undefined ? { externalProvider: fields.externalProvider } : {}),
      ...(fields.externalId !== undefined ? { externalId: fields.externalId } : {}),
      ...(fields.websiteUrl !== undefined ? { websiteUrl: fields.websiteUrl } : {}),
      ...(fields.mapsUrl !== undefined ? { mapsUrl: fields.mapsUrl } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.bookingUrl !== undefined ? { bookingUrl: fields.bookingUrl } : {}),
      ...(fields.ticketUrl !== undefined ? { ticketUrl: fields.ticketUrl } : {}),
      ...(fields.reservationRecommended !== undefined
        ? { reservationRecommended: fields.reservationRecommended ?? false }
        : {}),
      ...(fields.openingHours !== undefined ? { openingHours: jsonOrDbNull(fields.openingHours) } : {}),
      ...(fields.rating !== undefined ? { rating: fields.rating } : {}),
      ...(fields.priceLevel !== undefined ? { priceLevel: fields.priceLevel } : {}),
      ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
      ...(fields.durationMin !== undefined ? { durationMin: fields.durationMin } : {}),
      ...(fields.kidFriendly !== undefined ? { kidFriendly: fields.kidFriendly } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    } as Prisma.PlaceUncheckedUpdateInput,
  }) as unknown) as Promise<Place>;
}

export async function findPlaceByExternalId(
  tripId: number,
  externalProvider: string,
  externalId: string,
): Promise<Place | null> {
  return prisma.place.findFirst({
    where: { tripId, externalProvider, externalId } as Prisma.PlaceWhereInput,
  }) as Promise<Place | null>;
}

export async function deletePlace(tripId: number, placeId: number): Promise<boolean> {
  const result = await prisma.place.deleteMany({
    where: { id: placeId, tripId },
  });
  return result.count > 0;
}
