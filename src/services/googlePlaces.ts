import { config } from "../config";
import type { PlaceCategory } from "./places";

const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
const GOOGLE_PROVIDER = "google_places";

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.googleMapsUri",
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "websiteUri",
  "googleMapsUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "rating",
  "priceLevel",
].join(",");

type FetchLike = typeof fetch;

interface GoogleLocalizedText {
  text?: string;
}

interface GoogleLocation {
  latitude?: number;
  longitude?: number;
}

interface GooglePlaceResponse {
  id?: string;
  displayName?: GoogleLocalizedText;
  formattedAddress?: string;
  location?: GoogleLocation;
  types?: string[];
  websiteUri?: string;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: unknown;
  rating?: number;
  priceLevel?: string;
}

interface GoogleTextSearchResponse {
  places?: GooglePlaceResponse[];
}

interface GoogleApiErrorDetail {
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

interface GoogleApiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: GoogleApiErrorDetail[];
  };
}

export interface GooglePlacesClientOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export interface PlaceSearchOptions extends GooglePlacesClientOptions {
  destination?: string | null;
  maxResults?: number;
}

export interface PlaceDetailsOptions extends GooglePlacesClientOptions {}

export interface GooglePlaceSummary {
  provider: typeof GOOGLE_PROVIDER;
  externalId: string;
  name: string;
  category: PlaceCategory;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  types: string[];
}

export interface GooglePlaceDetails extends GooglePlaceSummary {
  websiteUrl: string | null;
  phone: string | null;
  openingHours: unknown | null;
  rating: number | null;
  priceLevel: number | null;
  reservationRecommended: boolean;
  bookingUrl: string | null;
  ticketUrl: string | null;
  advice: string | null;
}

function requireApiKey(apiKey = config.googleMapsApiKey): string {
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required to search Google Places.");
  }
  return apiKey;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Places API request failed (${response.status}): ${formatGoogleApiError(body)}`);
  }
  return (await response.json()) as T;
}

function formatGoogleApiError(body: string): string {
  try {
    const parsed = JSON.parse(body) as GoogleApiErrorResponse;
    const error = parsed.error;
    if (!error) return body;

    const details = (error.details ?? [])
      .map((detail) =>
        [
          detail.reason ? `reason=${detail.reason}` : null,
          detail.domain ? `domain=${detail.domain}` : null,
          detail.metadata?.service ? `service=${detail.metadata.service}` : null,
          detail.metadata?.consumer ? `consumer=${detail.metadata.consumer}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      )
      .filter(Boolean);

    return [
      error.status ? `status=${error.status}` : null,
      error.message ? `message=${error.message}` : null,
      details.length > 0 ? `details=[${details.join("; ")}]` : null,
    ]
      .filter(Boolean)
      .join(" ");
  } catch {
    return body;
  }
}

function normalizePriceLevel(value: string | undefined): number | null {
  switch (value) {
    case "PRICE_LEVEL_FREE":
      return 0;
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_MODERATE":
      return 2;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return null;
  }
}

export function mapGoogleTypesToPlaceCategory(types: string[] = []): PlaceCategory {
  const typeSet = new Set(types);
  if (["restaurant", "cafe", "bar", "bakery", "meal_takeaway", "food"].some((t) => typeSet.has(t))) {
    return "restaurant";
  }
  if (["museum", "art_gallery"].some((t) => typeSet.has(t))) {
    return "museum";
  }
  if (typeSet.has("national_park")) {
    return "national_park";
  }
  if (["travel_agency", "tourist_information_center"].some((t) => typeSet.has(t))) {
    return "tour";
  }
  if (["park", "natural_feature", "tourist_attraction", "point_of_interest"].some((t) => typeSet.has(t))) {
    return "natural_attraction";
  }
  return "other";
}

function buildAdvice(category: PlaceCategory, details: Pick<GooglePlaceDetails, "websiteUrl" | "phone">): {
  reservationRecommended: boolean;
  bookingUrl: string | null;
  ticketUrl: string | null;
  advice: string | null;
} {
  if (category === "restaurant") {
    const bookingUrl = details.websiteUrl;
    return {
      reservationRecommended: true,
      bookingUrl,
      ticketUrl: null,
      advice: bookingUrl || details.phone ? "Reservation recommended; use the website or phone before visiting." : null,
    };
  }

  if (category === "museum" || category === "national_park" || category === "tour") {
    const ticketUrl = details.websiteUrl;
    return {
      reservationRecommended: true,
      bookingUrl: null,
      ticketUrl,
      advice: ticketUrl ? "Check tickets, timed entry, or permits on the official website." : null,
    };
  }

  return { reservationRecommended: false, bookingUrl: null, ticketUrl: null, advice: null };
}

function toSummary(place: GooglePlaceResponse): GooglePlaceSummary | null {
  if (!place.id || !place.displayName?.text) return null;
  const types = place.types ?? [];
  return {
    provider: GOOGLE_PROVIDER,
    externalId: place.id,
    name: place.displayName.text,
    category: mapGoogleTypesToPlaceCategory(types),
    address: place.formattedAddress ?? null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    types,
  };
}

function toDetails(place: GooglePlaceResponse): GooglePlaceDetails {
  const summary = toSummary(place);
  if (!summary) throw new Error("Google Places details response did not include a place id and name.");
  const phone = place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null;
  const details = {
    ...summary,
    websiteUrl: place.websiteUri ?? null,
    phone,
    openingHours: place.regularOpeningHours ?? null,
    rating: place.rating ?? null,
    priceLevel: normalizePriceLevel(place.priceLevel),
  };
  return {
    ...details,
    ...buildAdvice(summary.category, details),
  };
}

export async function searchGooglePlaces(query: string, options: PlaceSearchOptions = {}): Promise<GooglePlaceSummary[]> {
  const apiKey = requireApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const textQuery = [query, options.destination].filter(Boolean).join(", ");
  const response = await fetchImpl(`${GOOGLE_PLACES_BASE_URL}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: options.maxResults ?? 5,
    }),
  });
  const body = await parseJson<GoogleTextSearchResponse>(response);
  return (body.places ?? []).map(toSummary).filter((place): place is GooglePlaceSummary => place !== null);
}

export async function getGooglePlaceDetails(
  externalId: string,
  options: PlaceDetailsOptions = {},
): Promise<GooglePlaceDetails> {
  const apiKey = requireApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(externalId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  return toDetails(await parseJson<GooglePlaceResponse>(response));
}
