import type { Place } from "@prisma/client";
import {
  getGooglePlaceDetails,
  searchGooglePlaces,
  type GooglePlaceDetails,
  type GooglePlaceSummary,
} from "./googlePlaces";
import { DEFAULT_PLACE_CATEGORY, findPlaceByExternalId, getPlace, updatePlace } from "./places";

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

function categoryForUpdate(place: Place, googlePlace: GooglePlaceDetails) {
  if (googlePlace.category !== DEFAULT_PLACE_CATEGORY) return googlePlace.category;
  return place.category ?? DEFAULT_PLACE_CATEGORY;
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
