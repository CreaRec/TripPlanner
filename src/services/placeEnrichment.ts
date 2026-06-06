import type { Place } from "@prisma/client";
import {
  getGooglePlaceDetails,
  searchGooglePlaces,
  type GooglePlaceDetails,
  type GooglePlaceSummary,
} from "./googlePlaces";
import {
  DEFAULT_PLACE_CATEGORY,
  addPlace,
  findPlaceByExternalId,
  getPlace,
  updatePlace,
  type PlaceCategory,
} from "./places";

export interface SearchPlaceDetailsInput {
  query: string;
  destination?: string | null;
  maxResults?: number;
}

export interface EnrichPlaceInput {
  tripId: number;
  placeId: number;
  destination?: string | null;
  query?: string | null;
  externalId?: string | null;
}

export interface EnrichPlaceResult {
  place: Place | null;
  googlePlace: GooglePlaceDetails | null;
  updated: boolean;
  duplicatePlaceId: number | null;
}

export interface SaveTripPlaceInput {
  tripId: number;
  query: string;
  destination?: string | null;
  externalId?: string | null;
  category?: PlaceCategory | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priority?: number | null;
  durationMin?: number | null;
  kidFriendly?: boolean | null;
  notes?: string | null;
}

export interface SaveTripPlaceResult {
  place: Place;
  googlePlace: GooglePlaceDetails | null;
  created: boolean;
  duplicatePlaceId: number | null;
}

export async function searchPlaceDetails(input: SearchPlaceDetailsInput): Promise<GooglePlaceSummary[]> {
  return searchGooglePlaces(input.query, {
    destination: input.destination,
    maxResults: input.maxResults,
  });
}

function mergeAdviceIntoNotes(notes: string | null, advice: string | null): string | null {
  if (!advice) return notes;
  if (notes?.includes(advice)) return notes;
  return [notes, advice].filter(Boolean).join("\n");
}

function categoryForUpdate(place: Place | null, googlePlace: GooglePlaceDetails) {
  if (googlePlace.category !== DEFAULT_PLACE_CATEGORY) return googlePlace.category;
  return place?.category ?? DEFAULT_PLACE_CATEGORY;
}

function inputFromGooglePlace(
  tripId: number,
  googlePlace: GooglePlaceDetails,
  input: Pick<SaveTripPlaceInput, "priority" | "durationMin" | "kidFriendly" | "notes">,
): Parameters<typeof addPlace>[0] {
  return {
    tripId,
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
    notes: mergeAdviceIntoNotes(input.notes ?? null, googlePlace.advice),
  };
}

export async function enrichPlace(input: EnrichPlaceInput): Promise<EnrichPlaceResult> {
  const place = await getPlace(input.tripId, input.placeId);
  if (!place) {
    return { place: null, googlePlace: null, updated: false, duplicatePlaceId: null };
  }

  const externalId =
    input.externalId ??
    place.externalId ??
    (await searchGooglePlaces(input.query ?? place.name, {
      destination: input.destination,
      maxResults: 1,
    }))[0]?.externalId;

  if (!externalId) {
    return { place, googlePlace: null, updated: false, duplicatePlaceId: null };
  }

  const googlePlace = await getGooglePlaceDetails(externalId);
  const duplicate = await findPlaceByExternalId(input.tripId, googlePlace.provider, googlePlace.externalId);
  if (duplicate && duplicate.id !== place.id) {
    return { place: duplicate, googlePlace, updated: false, duplicatePlaceId: duplicate.id };
  }

  const updatedPlace = await updatePlace(input.tripId, place.id, {
    name: googlePlace.name,
    category: categoryForUpdate(place, googlePlace),
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
    notes: mergeAdviceIntoNotes(place.notes, googlePlace.advice),
  });

  return { place: updatedPlace, googlePlace, updated: Boolean(updatedPlace), duplicatePlaceId: null };
}

export async function saveTripPlace(input: SaveTripPlaceInput): Promise<SaveTripPlaceResult> {
  const externalId =
    input.externalId ??
    (await searchGooglePlaces(input.query, {
      destination: input.destination,
      maxResults: 1,
    }))[0]?.externalId;

  if (!externalId) {
    const place = await addPlace({
      tripId: input.tripId,
      name: input.query,
      category: input.category,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      priority: input.priority,
      durationMin: input.durationMin,
      kidFriendly: input.kidFriendly,
      notes: input.notes,
    });
    return { place, googlePlace: null, created: true, duplicatePlaceId: null };
  }

  const googlePlace = await getGooglePlaceDetails(externalId);
  const existing = await findPlaceByExternalId(input.tripId, googlePlace.provider, googlePlace.externalId);
  if (existing) {
    const updated = await updatePlace(input.tripId, existing.id, {
      ...inputFromGooglePlace(input.tripId, googlePlace, input),
      category: categoryForUpdate(existing, googlePlace),
      notes: mergeAdviceIntoNotes(
        [existing.notes, input.notes].filter(Boolean).join("\n") || null,
        googlePlace.advice,
      ),
    });
    return {
      place: updated ?? existing,
      googlePlace,
      created: false,
      duplicatePlaceId: existing.id,
    };
  }

  const place = await addPlace(inputFromGooglePlace(input.tripId, googlePlace, input));
  return { place, googlePlace, created: true, duplicatePlaceId: null };
}
