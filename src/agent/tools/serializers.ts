import type { GooglePlaceDetails } from "../../services/providers/googlePlaces";
import { searchPlaceDetails } from "../../services/places/placeEnrichment";
import type { SavedPlace } from "../../services/places/savedPlaces";

export function googlePlaceToToolResult(googlePlace: GooglePlaceDetails) {
  return {
    external_id: googlePlace.externalId,
    name: googlePlace.name,
    category: googlePlace.category,
    address: googlePlace.address,
    website_url: googlePlace.websiteUrl,
    maps_url: googlePlace.mapsUrl,
    phone: googlePlace.phone,
    booking_url: googlePlace.bookingUrl,
    ticket_url: googlePlace.ticketUrl,
    reservation_recommended: googlePlace.reservationRecommended,
    advice: googlePlace.advice,
  };
}

export function savedPlaceToToolResult(place: SavedPlace) {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    status: place.status,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    website_url: place.websiteUrl,
    maps_url: place.mapsUrl,
    phone: place.phone,
    booking_url: place.bookingUrl,
    ticket_url: place.ticketUrl,
    reservation_recommended: place.reservationRecommended,
    rating: place.rating,
    price_level: place.priceLevel,
    priority: place.priority,
    duration_min: place.durationMin,
    kid_friendly: place.kidFriendly,
    source_note: place.sourceNote,
    notes: place.notes,
  };
}

export function temporarySavedPlaceFromSearchResult(
  telegramId: number,
  place: Awaited<ReturnType<typeof searchPlaceDetails>>[number],
): SavedPlace {
  return {
    id: -1,
    telegramId: BigInt(telegramId),
    name: place.name,
    category: place.category,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    externalProvider: place.provider,
    externalId: place.externalId,
    websiteUrl: null,
    mapsUrl: place.mapsUrl,
    phone: null,
    bookingUrl: null,
    ticketUrl: null,
    reservationRecommended: false,
    openingHours: null,
    rating: null,
    priceLevel: null,
    priority: null,
    durationMin: null,
    kidFriendly: null,
    status: "temporary",
    sourceNote: "Temporary route comparison stop",
    notes: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
