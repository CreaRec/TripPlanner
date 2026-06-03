import { config } from "../config";
import type { SavedPlace } from "./savedPlaces";
import {
  decodeEncodedPolyline,
  distanceToPolylineMeters,
  type LatLng,
} from "./routeGeometry";

const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const ROUTE_WITH_POLYLINE_FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";
const ROUTE_SUMMARY_FIELD_MASK = "routes.duration,routes.distanceMeters";

type FetchLike = typeof fetch;

interface GoogleRoutesClientOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export interface RouteScoringOptions extends GoogleRoutesClientOptions {
  maxDistanceFromRouteMeters?: number;
  maxRouteChecks?: number;
  maxDetourDurationSeconds?: number;
  maxDetourRatio?: number;
  includeRejectedSuggestions?: boolean;
}

export interface RouteSummary {
  durationSeconds: number;
  distanceMeters: number;
  encodedPolyline: string | null;
}

export interface SavedPlaceRouteSuggestion {
  place: SavedPlace;
  origin: string;
  destination: string;
  startLocation: LatLng;
  stopLocation: LatLng;
  endLocation: LatLng;
  baseEncodedPolyline: string;
  detourEncodedPolyline: string | null;
  distanceFromRouteMeters: number;
  detourDurationSeconds: number;
  detourDistanceMeters: number;
  detourRatio: number;
  withinDetourThreshold: boolean;
  routeDurationSeconds: number;
  routeDistanceMeters: number;
}

interface GoogleRouteResponse {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    polyline?: {
      encodedPolyline?: string;
    };
  }>;
}

interface GoogleApiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function requireApiKey(apiKey = config.googleMapsApiKey): string {
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required to compute routes.");
  }
  return apiKey;
}

function parseDurationSeconds(duration: string | undefined): number {
  const match = duration?.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) throw new Error("Google Routes response did not include a valid duration.");
  return Math.round(Number(match[1]));
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Routes API request failed (${response.status}): ${formatGoogleApiError(body)}`);
  }
  return (await response.json()) as T;
}

function formatGoogleApiError(body: string): string {
  try {
    const parsed = JSON.parse(body) as GoogleApiErrorResponse;
    const error = parsed.error;
    if (!error) return body;
    return [
      error.status ? `status=${error.status}` : null,
      error.message ? `message=${error.message}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  } catch {
    return body;
  }
}

function waypointFromAddress(address: string) {
  return { address };
}

function waypointFromLatLng(point: LatLng) {
  return {
    location: {
      latLng: {
        latitude: point.latitude,
        longitude: point.longitude,
      },
    },
  };
}

function toRouteSummary(body: GoogleRouteResponse, includePolyline: boolean): RouteSummary {
  const route = body.routes?.[0];
  if (!route) {
    throw new Error("Google Routes response did not include a route.");
  }
  return {
    durationSeconds: parseDurationSeconds(route.duration),
    distanceMeters: route.distanceMeters ?? 0,
    encodedPolyline: includePolyline ? route.polyline?.encodedPolyline ?? null : null,
  };
}

async function computeRoute(
  origin: string,
  destination: string,
  options: GoogleRoutesClientOptions & { waypoint?: LatLng; includePolyline?: boolean } = {},
): Promise<RouteSummary> {
  const apiKey = requireApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const includePolyline = Boolean(options.includePolyline);
  const response = await fetchImpl(GOOGLE_ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": includePolyline ? ROUTE_WITH_POLYLINE_FIELD_MASK : ROUTE_SUMMARY_FIELD_MASK,
    },
    body: JSON.stringify({
      origin: waypointFromAddress(origin),
      destination: waypointFromAddress(destination),
      ...(options.waypoint ? { intermediates: [waypointFromLatLng(options.waypoint)] } : {}),
      travelMode: "DRIVE",
      polylineQuality: includePolyline ? "OVERVIEW" : undefined,
      computeAlternativeRoutes: false,
    }),
  });

  return toRouteSummary(await parseJson<GoogleRouteResponse>(response), includePolyline);
}

function savedPlaceLocation(place: SavedPlace): LatLng | null {
  if (place.latitude === null || place.longitude === null) return null;
  return { latitude: place.latitude, longitude: place.longitude };
}

export async function suggestSavedPlacesOnRoute(
  origin: string,
  destination: string,
  savedPlaces: SavedPlace[],
  options: RouteScoringOptions = {},
): Promise<SavedPlaceRouteSuggestion[]> {
  const maxDistanceFromRouteMeters = options.maxDistanceFromRouteMeters ?? 50_000;
  const maxRouteChecks = options.maxRouteChecks ?? 15;
  const maxDetourDurationSeconds = options.maxDetourDurationSeconds ?? 30 * 60;
  const maxDetourRatio = options.maxDetourRatio ?? 0.15;
  const includeRejectedSuggestions = options.includeRejectedSuggestions ?? false;

  const baseRoute = await computeRoute(origin, destination, {
    ...options,
    includePolyline: true,
  });
  if (!baseRoute.encodedPolyline) {
    throw new Error("Google Routes response did not include an encoded polyline.");
  }

  const routeLine = decodeEncodedPolyline(baseRoute.encodedPolyline);
  const startLocation = routeLine[0];
  const endLocation = routeLine.at(-1);
  if (!startLocation || !endLocation) {
    throw new Error("Google Routes encoded polyline did not include route endpoints.");
  }
  const candidates = savedPlaces
    .map((place) => {
      const location = savedPlaceLocation(place);
      if (!location) return null;
      return {
        place,
        location,
        distanceFromRouteMeters: distanceToPolylineMeters(location, routeLine),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => {
      return candidate !== null && candidate.distanceFromRouteMeters <= maxDistanceFromRouteMeters;
    })
    .sort((a, b) => a.distanceFromRouteMeters - b.distanceFromRouteMeters)
    .slice(0, maxRouteChecks);

  const suggestions: SavedPlaceRouteSuggestion[] = [];
  for (const candidate of candidates) {
    const detourRoute = await computeRoute(origin, destination, {
      ...options,
      waypoint: candidate.location,
      includePolyline: true,
    });
    const detourDurationSeconds = detourRoute.durationSeconds - baseRoute.durationSeconds;
    const detourDistanceMeters = detourRoute.distanceMeters - baseRoute.distanceMeters;
    const detourRatio = baseRoute.durationSeconds > 0 ? detourDurationSeconds / baseRoute.durationSeconds : 0;

    const withinDetourThreshold = detourDurationSeconds <= maxDetourDurationSeconds || detourRatio <= maxDetourRatio;
    if (withinDetourThreshold || includeRejectedSuggestions) {
      suggestions.push({
        place: candidate.place,
        origin,
        destination,
        startLocation,
        stopLocation: candidate.location,
        endLocation,
        baseEncodedPolyline: baseRoute.encodedPolyline,
        detourEncodedPolyline: detourRoute.encodedPolyline,
        distanceFromRouteMeters: candidate.distanceFromRouteMeters,
        detourDurationSeconds,
        detourDistanceMeters,
        detourRatio,
        withinDetourThreshold,
        routeDurationSeconds: detourRoute.durationSeconds,
        routeDistanceMeters: detourRoute.distanceMeters,
      });
    }
  }

  return suggestions.sort((a, b) => a.detourDurationSeconds - b.detourDurationSeconds);
}
