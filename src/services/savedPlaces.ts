import { Prisma, type SavedPlace as PrismaSavedPlace } from "@prisma/client";
import { prisma } from "../db/prisma";
import { DEFAULT_PLACE_CATEGORY, PLACE_CATEGORIES, type PlaceCategory } from "./places";
import {
  getGooglePlaceDetails,
  searchGooglePlaces,
  type GooglePlaceDetails,
  type GooglePlaceSummary,
} from "./googlePlaces";

export const SAVED_PLACE_STATUSES = ["want_to_visit", "visited", "archived"] as const;
export type SavedPlaceStatus = (typeof SAVED_PLACE_STATUSES)[number];

export { PLACE_CATEGORIES };
export type { PlaceCategory };

export type SavedPlace = PrismaSavedPlace & {
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
  sourceNote: string | null;
};

export interface AddSavedPlaceInput {
  telegramId: number;
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
  status?: SavedPlaceStatus | null;
  sourceNote?: string | null;
  notes?: string | null;
}

export type UpdateSavedPlaceFields = Omit<Partial<AddSavedPlaceInput>, "telegramId">;

export interface ListSavedPlacesOptions {
  status?: SavedPlaceStatus | null;
  category?: PlaceCategory | null;
  limit?: number;
  withCoordinatesOnly?: boolean;
}

export interface SaveInterestingPlaceInput {
  telegramId: number;
  query: string;
  externalId?: string | null;
  status?: SavedPlaceStatus | null;
  sourceNote?: string | null;
  notes?: string | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
}

export interface SaveInterestingPlaceResult {
  place: SavedPlace;
  googlePlace: GooglePlaceDetails | null;
  created: boolean;
}

export interface EnrichSavedPlaceInput {
  telegramId: number;
  savedPlaceId: number;
  query?: string | null;
  externalId?: string | null;
}

export interface EnrichSavedPlaceResult {
  place: SavedPlace | null;
  googlePlace: GooglePlaceDetails | null;
  updated: boolean;
  duplicateSavedPlaceId: number | null;
}

function jsonOrDbNull(value: Prisma.InputJsonValue | null | undefined): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value ?? Prisma.DbNull;
}

function requireStatus(value: SavedPlaceStatus | null | undefined): SavedPlaceStatus {
  return value ?? "want_to_visit";
}

function mergeNotes(existing: string | null, next: string | null | undefined): string | null {
  if (!next) return existing;
  if (existing?.includes(next)) return existing;
  return [existing, next].filter(Boolean).join("\n");
}

function mergeAdviceIntoNotes(notes: string | null, advice: string | null): string | null {
  return mergeNotes(notes, advice ?? undefined);
}

function categoryForUpdate(savedPlace: SavedPlace | null, googlePlace: GooglePlaceDetails) {
  if (googlePlace.category !== DEFAULT_PLACE_CATEGORY) return googlePlace.category;
  return savedPlace?.category ?? DEFAULT_PLACE_CATEGORY;
}

function inputFromGooglePlace(
  telegramId: number,
  googlePlace: GooglePlaceDetails,
  input: Pick<SaveInterestingPlaceInput, "status" | "sourceNote" | "notes" | "priority" | "durationMin" | "kidFriendly">,
): AddSavedPlaceInput {
  return {
    telegramId,
    name: googlePlace.name,
    category: googlePlace.category,
    address: googlePlace.address,
    latitude: googlePlace.latitude,
    longitude: googlePlace.longitude,
    externalProvider: googlePlace.provider,
    externalId: googlePlace.externalId,
    websiteUrl: googlePlace.websiteUrl,
    mapsUrl: googlePlace.mapsUrl,
    phone: googlePlace.phone,
    bookingUrl: googlePlace.bookingUrl,
    ticketUrl: googlePlace.ticketUrl,
    reservationRecommended: googlePlace.reservationRecommended,
    openingHours: googlePlace.openingHours === null ? null : (googlePlace.openingHours as object),
    rating: googlePlace.rating,
    priceLevel: googlePlace.priceLevel,
    priority: input.priority,
    durationMin: input.durationMin,
    kidFriendly: input.kidFriendly,
    status: input.status,
    sourceNote: input.sourceNote,
    notes: mergeAdviceIntoNotes(input.notes ?? null, googlePlace.advice),
  };
}

export async function addSavedPlace(input: AddSavedPlaceInput): Promise<SavedPlace> {
  return (prisma.savedPlace.create({
    data: {
      telegramId: BigInt(input.telegramId),
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
      status: requireStatus(input.status),
      sourceNote: input.sourceNote ?? null,
      notes: input.notes ?? null,
    } as Prisma.SavedPlaceUncheckedCreateInput,
  }) as unknown) as Promise<SavedPlace>;
}

export async function listSavedPlaces(
  telegramId: number,
  options: ListSavedPlacesOptions = {},
): Promise<SavedPlace[]> {
  return (prisma.savedPlace.findMany({
    where: {
      telegramId: BigInt(telegramId),
      ...(options.status ? { status: options.status } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.withCoordinatesOnly ? { latitude: { not: null }, longitude: { not: null } } : {}),
    },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    ...(options.limit ? { take: options.limit } : {}),
  }) as unknown) as Promise<SavedPlace[]>;
}

export async function getSavedPlace(telegramId: number, savedPlaceId: number): Promise<SavedPlace | null> {
  return (prisma.savedPlace.findFirst({
    where: { id: savedPlaceId, telegramId: BigInt(telegramId) },
  }) as unknown) as Promise<SavedPlace | null>;
}

export async function findSavedPlaceByExternalId(
  telegramId: number,
  externalProvider: string,
  externalId: string,
): Promise<SavedPlace | null> {
  return (prisma.savedPlace.findFirst({
    where: {
      telegramId: BigInt(telegramId),
      externalProvider,
      externalId,
    } as Prisma.SavedPlaceWhereInput,
  }) as unknown) as Promise<SavedPlace | null>;
}

export async function updateSavedPlace(
  telegramId: number,
  savedPlaceId: number,
  fields: UpdateSavedPlaceFields,
): Promise<SavedPlace | null> {
  const savedPlace = await getSavedPlace(telegramId, savedPlaceId);
  if (!savedPlace) return null;

  return (prisma.savedPlace.update({
    where: { id: savedPlaceId },
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
      ...(fields.status !== undefined ? { status: requireStatus(fields.status) } : {}),
      ...(fields.sourceNote !== undefined ? { sourceNote: fields.sourceNote } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    } as Prisma.SavedPlaceUncheckedUpdateInput,
  }) as unknown) as Promise<SavedPlace>;
}

export async function deleteSavedPlace(telegramId: number, savedPlaceId: number): Promise<boolean> {
  const result = await prisma.savedPlace.deleteMany({
    where: { id: savedPlaceId, telegramId: BigInt(telegramId) },
  });
  return result.count > 0;
}

export async function searchInterestingPlaceCandidates(
  query: string,
  maxResults?: number,
): Promise<GooglePlaceSummary[]> {
  return searchGooglePlaces(query, { maxResults });
}

export async function saveInterestingPlace(input: SaveInterestingPlaceInput): Promise<SaveInterestingPlaceResult> {
  const externalId =
    input.externalId ??
    (await searchGooglePlaces(input.query, {
      maxResults: 1,
    }))[0]?.externalId;

  if (!externalId) {
    const place = await addSavedPlace({
      telegramId: input.telegramId,
      name: input.query,
      status: input.status,
      sourceNote: input.sourceNote,
      notes: input.notes,
      priority: input.priority,
      durationMin: input.durationMin,
      kidFriendly: input.kidFriendly,
    });
    return { place, googlePlace: null, created: true };
  }

  const googlePlace = await getGooglePlaceDetails(externalId);
  const existing = await findSavedPlaceByExternalId(input.telegramId, googlePlace.provider, googlePlace.externalId);
  if (existing) {
    const updated = await updateSavedPlace(input.telegramId, existing.id, {
      ...inputFromGooglePlace(input.telegramId, googlePlace, input),
      category: categoryForUpdate(existing, googlePlace),
      sourceNote: mergeNotes(existing.sourceNote, input.sourceNote),
      notes: mergeAdviceIntoNotes(mergeNotes(existing.notes, input.notes), googlePlace.advice),
    });
    return { place: updated ?? existing, googlePlace, created: false };
  }

  const place = await addSavedPlace(inputFromGooglePlace(input.telegramId, googlePlace, input));
  return { place, googlePlace, created: true };
}

export async function enrichSavedPlace(input: EnrichSavedPlaceInput): Promise<EnrichSavedPlaceResult> {
  const savedPlace = await getSavedPlace(input.telegramId, input.savedPlaceId);
  if (!savedPlace) {
    return { place: null, googlePlace: null, updated: false, duplicateSavedPlaceId: null };
  }

  const externalId =
    input.externalId ??
    savedPlace.externalId ??
    (await searchGooglePlaces(input.query ?? savedPlace.name, {
      maxResults: 1,
    }))[0]?.externalId;

  if (!externalId) {
    return { place: savedPlace, googlePlace: null, updated: false, duplicateSavedPlaceId: null };
  }

  const googlePlace = await getGooglePlaceDetails(externalId);
  const duplicate = await findSavedPlaceByExternalId(
    input.telegramId,
    googlePlace.provider,
    googlePlace.externalId,
  );
  if (duplicate && duplicate.id !== savedPlace.id) {
    return { place: duplicate, googlePlace, updated: false, duplicateSavedPlaceId: duplicate.id };
  }

  const updatedPlace = await updateSavedPlace(input.telegramId, savedPlace.id, {
    name: googlePlace.name,
    category: categoryForUpdate(savedPlace, googlePlace),
    address: googlePlace.address,
    latitude: googlePlace.latitude,
    longitude: googlePlace.longitude,
    externalProvider: googlePlace.provider,
    externalId: googlePlace.externalId,
    websiteUrl: googlePlace.websiteUrl,
    mapsUrl: googlePlace.mapsUrl,
    phone: googlePlace.phone,
    bookingUrl: googlePlace.bookingUrl,
    ticketUrl: googlePlace.ticketUrl,
    reservationRecommended: googlePlace.reservationRecommended,
    openingHours: googlePlace.openingHours === null ? null : (googlePlace.openingHours as object),
    rating: googlePlace.rating,
    priceLevel: googlePlace.priceLevel,
    notes: mergeAdviceIntoNotes(savedPlace.notes, googlePlace.advice),
  });

  return {
    place: updatedPlace,
    googlePlace,
    updated: Boolean(updatedPlace),
    duplicateSavedPlaceId: null,
  };
}
