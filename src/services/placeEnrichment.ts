import type { Place } from "@prisma/client";
import {
  fetchGooglePlaceDetails,
  placeMissingFields,
  resolveGoogleExternalId,
} from "./enrichmentUtils";
import {
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
import { getSavedPlace, type SavedPlace } from "./savedPlaces";

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
  enriched: boolean;
  missingFields: string[];
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

export interface SaveTripPlaceFromSavedInput {
  tripId: number;
  telegramId: number;
  savedPlaceId: number;
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
  enriched: boolean;
  missingFields: string[];
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

function resultFromTripPlace(
  place: Place,
  googlePlace: GooglePlaceDetails | null,
  created: boolean,
  duplicatePlaceId: number | null,
): SaveTripPlaceResult {
  return {
    place,
    googlePlace,
    created,
    duplicatePlaceId,
    enriched: Boolean(googlePlace || place.externalId),
    missingFields: placeMissingFields(place),
  };
}

function savedPlaceToTripInput(
  saved: SavedPlace,
  input: Pick<SaveTripPlaceFromSavedInput, "tripId" | "priority" | "durationMin" | "kidFriendly" | "notes">,
): Parameters<typeof addPlace>[0] {
  return {
    tripId: input.tripId,
    name: saved.name,
    category: saved.category,
    address: saved.address,
    latitude: saved.latitude,
    longitude: saved.longitude,
    externalProvider: saved.externalProvider,
    externalId: saved.externalId,
    websiteUrl: saved.websiteUrl,
    mapsUrl: saved.mapsUrl,
    phone: saved.phone,
    bookingUrl: saved.bookingUrl,
    ticketUrl: saved.ticketUrl,
    reservationRecommended: saved.reservationRecommended,
    openingHours: saved.openingHours === null ? null : (saved.openingHours as object),
    rating: saved.rating,
    priceLevel: saved.priceLevel,
    priority: input.priority ?? saved.priority,
    durationMin: input.durationMin ?? saved.durationMin,
    kidFriendly: input.kidFriendly ?? saved.kidFriendly,
    notes: [saved.notes, input.notes].filter(Boolean).join("\n") || null,
  };
}

export async function saveTripPlaceFromSaved(input: SaveTripPlaceFromSavedInput): Promise<SaveTripPlaceResult> {
  const saved = await getSavedPlace(input.telegramId, input.savedPlaceId);
  if (!saved) {
    throw new Error("Saved place not found.");
  }

  if (saved.externalProvider && saved.externalId) {
    const existing = await findPlaceByExternalId(input.tripId, saved.externalProvider, saved.externalId);
    if (existing) {
      return resultFromTripPlace(existing, null, false, existing.id);
    }
  }

  const place = await addPlace(savedPlaceToTripInput(saved, input));
  return resultFromTripPlace(place, null, true, null);
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
    return {
      place: null,
      googlePlace: null,
      updated: false,
      duplicatePlaceId: null,
      enriched: false,
      missingFields: [],
    };
  }

  const externalId = await resolveGoogleExternalId(input.query ?? place.name, {
    destination: input.destination,
    externalId: input.externalId ?? place.externalId,
  });

  if (!externalId) {
    return {
      place,
      googlePlace: null,
      updated: false,
      duplicatePlaceId: null,
      enriched: false,
      missingFields: placeMissingFields(place),
    };
  }

  const googlePlace = await fetchGooglePlaceDetails(externalId);
  if (!googlePlace) {
    return {
      place,
      googlePlace: null,
      updated: false,
      duplicatePlaceId: null,
      enriched: false,
      missingFields: placeMissingFields(place),
    };
  }

  const duplicate = await findPlaceByExternalId(input.tripId, googlePlace.provider, googlePlace.externalId);
  if (duplicate && duplicate.id !== place.id) {
    return {
      place: duplicate,
      googlePlace,
      updated: false,
      duplicatePlaceId: duplicate.id,
      enriched: true,
      missingFields: placeMissingFields(duplicate),
    };
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

  const resultPlace = updatedPlace ?? place;
  return {
    place: updatedPlace,
    googlePlace,
    updated: Boolean(updatedPlace),
    duplicatePlaceId: null,
    enriched: true,
    missingFields: placeMissingFields(resultPlace),
  };
}

export async function saveTripPlace(input: SaveTripPlaceInput): Promise<SaveTripPlaceResult> {
  const externalId = await resolveGoogleExternalId(input.query, {
    destination: input.destination,
    externalId: input.externalId,
  });

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
    return resultFromTripPlace(place, null, true, null);
  }

  const googlePlace = await fetchGooglePlaceDetails(externalId);
  if (!googlePlace) {
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
    return resultFromTripPlace(place, null, true, null);
  }

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
    return resultFromTripPlace(updated ?? existing, googlePlace, false, existing.id);
  }

  const place = await addPlace(inputFromGooglePlace(input.tripId, googlePlace, input));
  return resultFromTripPlace(place, googlePlace, true, null);
}
