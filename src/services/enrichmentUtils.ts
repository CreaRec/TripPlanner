import { getGooglePlaceDetails, searchGooglePlaces, type GooglePlaceDetails } from "./googlePlaces";

export interface PlaceLikeForMissingFields {
  address?: string | null;
  mapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export function placeMissingFields(place: PlaceLikeForMissingFields): string[] {
  const missing: string[] = [];
  if (!place.address?.trim()) missing.push("address");
  if (!place.mapsUrl?.trim()) missing.push("maps_url");
  if (place.latitude === null || place.latitude === undefined || place.longitude === null || place.longitude === undefined) {
    missing.push("coordinates");
  }
  return missing;
}

export async function resolveGoogleExternalId(
  query: string,
  options: { destination?: string | null; externalId?: string | null } = {},
): Promise<string | null> {
  if (options.externalId) return options.externalId;
  try {
    return (await searchGooglePlaces(query, { destination: options.destination, maxResults: 1 }))[0]?.externalId ?? null;
  } catch {
    return null;
  }
}

export async function fetchGooglePlaceDetails(externalId: string): Promise<GooglePlaceDetails | null> {
  try {
    return await getGooglePlaceDetails(externalId);
  } catch {
    return null;
  }
}

export function metaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function googlePlaceMetadata(google: GooglePlaceDetails): Record<string, unknown> {
  return {
    maps_url: google.mapsUrl,
    latitude: google.latitude,
    longitude: google.longitude,
    phone: google.phone,
    external_id: google.externalId,
    external_provider: google.provider,
  };
}
