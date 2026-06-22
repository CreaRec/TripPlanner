import type { Prisma, Reservation } from "@prisma/client";
import { isAviationStackConfigured } from "../../config";
import { ExternalProvider, parseEnrichmentProvider } from "./externalProvider";
import type { AviationStackAirport, AviationStackFlight } from "../providers/aviationStack";
import { lookupAirportByIata, lookupFlight } from "../providers/aviationStack";
import type { GooglePlaceDetails } from "../providers/googlePlaces";
import {
  fetchGooglePlaceDetails,
  googlePlaceMetadata,
  metaString,
  resolveGoogleExternalId,
} from "./enrichmentUtils";
import {
  addReservation,
  isEnrichableReservationType,
  updateReservation,
  ReservationType,
  type AddReservationInput,
  type UpdateReservationFields,
} from "./reservations";

export interface SaveReservationWithEnrichmentInput extends AddReservationInput {
  destination?: string | null;
}

export interface SaveReservationWithEnrichmentResult {
  reservation: Reservation;
  enriched: boolean;
  missingFields: string[];
}

export interface ReservationEnrichmentTelemetry {
  aviationStackConfigured: boolean;
  aviationStackFlightRequested: boolean;
  aviationStackFlightMatched: boolean;
  aviationStackAirportRequests: number;
  googlePlacesRequests: number;
}

/** @deprecated Use ReservationEnrichmentTelemetry */
export type FlightEnrichmentTelemetry = ReservationEnrichmentTelemetry;

export interface ReEnrichReservationResult {
  reservation: Reservation;
  enriched: boolean;
  missingFields: string[];
  enrichmentProvider: ExternalProvider | null;
  telemetry: ReservationEnrichmentTelemetry;
}

interface EnrichedReservationFields {
  address: string | null;
  metadata: Prisma.InputJsonValue;
  enriched: boolean;
  provider?: string | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  enrichmentProvider?: ExternalProvider | null;
  telemetry?: ReservationEnrichmentTelemetry;
}

interface EnrichReservationOptions {
  force?: boolean;
  telemetry?: ReservationEnrichmentTelemetry;
}

const ENRICHMENT_META_KEYS = new Set(["flight_status", "enrichment_provider"]);
const GOOGLE_PLACE_META_KEYS = new Set([
  "maps_url",
  "latitude",
  "longitude",
  "phone",
  "external_id",
  "external_provider",
]);

function emptyTelemetry(): ReservationEnrichmentTelemetry {
  return {
    aviationStackConfigured: isAviationStackConfigured(),
    aviationStackFlightRequested: false,
    aviationStackFlightMatched: false,
    aviationStackAirportRequests: 0,
    googlePlacesRequests: 0,
  };
}

function asMetadataRecord(metadata: Prisma.InputJsonValue | undefined): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }
  return {};
}

function isEnrichmentMetaKey(key: string): boolean {
  return key.startsWith("origin_") || key.startsWith("destination_") || ENRICHMENT_META_KEYS.has(key);
}

export function stripFlightEnrichmentMetadata(metadata: unknown): Record<string, unknown> {
  const meta = asMetadataRecord(metadata as Prisma.InputJsonValue | undefined);
  for (const key of Object.keys(meta)) {
    if (isEnrichmentMetaKey(key)) {
      delete meta[key];
    }
  }
  return meta;
}

export function stripPlaceEnrichmentMetadata(metadata: unknown): Record<string, unknown> {
  const meta = asMetadataRecord(metadata as Prisma.InputJsonValue | undefined);
  for (const key of Object.keys(meta)) {
    if (GOOGLE_PLACE_META_KEYS.has(key) || key === "enrichment_provider") {
      delete meta[key];
    }
  }
  return meta;
}

export function stripReservationEnrichmentMetadata(
  reservation: Pick<Reservation, "type" | "metadata">,
): Record<string, unknown> {
  if (reservation.type === ReservationType.Flight) {
    const meta = stripFlightEnrichmentMetadata(reservation.metadata);
    for (const key of Object.keys(meta)) {
      if (GOOGLE_PLACE_META_KEYS.has(key)) {
        delete meta[key];
      }
    }
    return meta;
  }
  return stripPlaceEnrichmentMetadata(reservation.metadata);
}

export { isEnrichableReservationType };

function setMetaValue(
  meta: Record<string, unknown>,
  key: string,
  value: unknown,
  force: boolean,
): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (!force && meta[key] !== null && meta[key] !== undefined && meta[key] !== "") return false;
  if (meta[key] === value) return false;
  meta[key] = value;
  return true;
}

function isIataCode(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value);
}

function flightDateFromStartAt(startAt: string | Date | null | undefined): string | null {
  if (!startAt) return null;
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseRouteCodes(route: string): { origin: string | null; destination: string | null } {
  const match = route.match(/\b([A-Za-z]{3})\s*(?:→|->|—|–|-)\s*([A-Za-z]{3})\b/i);
  if (!match) return { origin: null, destination: null };
  return { origin: match[1].toUpperCase(), destination: match[2].toUpperCase() };
}

async function lookupPlace(
  query: string,
  destination: string | null | undefined,
  telemetry: ReservationEnrichmentTelemetry,
): Promise<GooglePlaceDetails | null> {
  telemetry.googlePlacesRequests += 1;
  const externalId = await resolveGoogleExternalId(query, { destination });
  if (!externalId) return null;
  return fetchGooglePlaceDetails(externalId);
}

export function parseFlightEndpoints(
  title: string,
  metadata: unknown,
): { origin: string | null; destination: string | null } {
  const codeRoute = title.match(/\b([A-Za-z]{3})\s*(?:→|->|—|–|-)\s*([A-Za-z]{3})\b/i);
  if (codeRoute) {
    return { origin: codeRoute[1].toUpperCase(), destination: codeRoute[2].toUpperCase() };
  }

  const routeMeta = metaString(metadata, "route");
  if (routeMeta) {
    const parsedRoute = parseRouteCodes(routeMeta);
    if (parsedRoute.origin || parsedRoute.destination) return parsedRoute;
  }

  const originMeta =
    metaString(metadata, "origin_airport") ??
    metaString(metadata, "origin") ??
    metaString(metadata, "departure_airport") ??
    metaString(metadata, "from");
  const destMeta =
    metaString(metadata, "destination_airport") ??
    metaString(metadata, "destination") ??
    metaString(metadata, "arrival_airport") ??
    metaString(metadata, "to");
  if (originMeta || destMeta) {
    return { origin: originMeta, destination: destMeta };
  }

  const toMatch = title.match(/^(.+?)\s+(?:to|→|->)\s+(.+)$/i);
  if (toMatch) {
    const left = toMatch[1]
      .replace(/\b[A-Z0-9]{2}\s*\d{1,4}\b/gi, "")
      .replace(/alaska airlines?/gi, "")
      .trim();
    const right = toMatch[2]
      .replace(/\b[A-Z0-9]{2}\s*\d{1,4}\b/gi, "")
      .trim();
    if (left && right) return { origin: left, destination: right };
  }

  return { origin: null, destination: null };
}

export function parseFlightNumber(title: string, metadata: unknown): string | null {
  const fromMeta = metaString(metadata, "flight_number");
  if (fromMeta) return fromMeta.toUpperCase().replace(/\s+/g, "");

  const match = title.match(/\b([A-Z0-9]{2})\s*(\d{1,4})\b/i);
  if (match) return `${match[1].toUpperCase()}${match[2]}`;
  return null;
}

function applyAviationStackAirport(
  prefix: "origin" | "destination",
  airport: AviationStackAirport,
  meta: Record<string, unknown>,
  force: boolean,
): boolean {
  let changed = false;
  const addressParts = [airport.city, airport.country].filter(Boolean);
  if (setMetaValue(meta, `${prefix}_airport`, airport.iata, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_name`, airport.name, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_address`, addressParts.length > 0 ? addressParts.join(", ") : null, force)) {
    changed = true;
  }
  if (setMetaValue(meta, `${prefix}_latitude`, airport.latitude, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_longitude`, airport.longitude, force)) changed = true;
  if (changed) {
    meta.enrichment_provider = ExternalProvider.AviationStack;
  }
  return changed;
}

function applyFlightEndpoint(
  prefix: "origin" | "destination",
  endpoint: AviationStackFlight["departure"],
  meta: Record<string, unknown>,
  force: boolean,
): boolean {
  let changed = false;
  if (setMetaValue(meta, `${prefix}_airport`, endpoint.iata, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_name`, endpoint.airport, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_terminal`, endpoint.terminal, force)) changed = true;
  if (setMetaValue(meta, `${prefix}_gate`, endpoint.gate, force)) changed = true;
  if (changed) {
    meta.enrichment_provider = ExternalProvider.AviationStack;
  }
  return changed;
}

function applyFlightData(
  flight: AviationStackFlight,
  meta: Record<string, unknown>,
  force: boolean,
): { enriched: boolean; provider: string | null; startAt: string | null; endAt: string | null } {
  let enriched = false;
  if (setMetaValue(meta, "flight_number", flight.flightIata, force)) enriched = true;
  if (setMetaValue(meta, "flight_status", flight.flightStatus, force)) enriched = true;
  if (applyFlightEndpoint("origin", flight.departure, meta, force)) enriched = true;
  if (applyFlightEndpoint("destination", flight.arrival, meta, force)) enriched = true;
  if (enriched) {
    meta.enrichment_provider = ExternalProvider.AviationStack;
  }

  return {
    enriched,
    provider: flight.airlineName,
    startAt: flight.departure.scheduled,
    endAt: flight.arrival.scheduled,
  };
}

async function enrichAirportViaAviationStack(
  iataCode: string,
  prefix: "origin" | "destination",
  meta: Record<string, unknown>,
  force: boolean,
  telemetry: ReservationEnrichmentTelemetry,
): Promise<{ enriched: boolean; label: string | null }> {
  telemetry.aviationStackAirportRequests += 1;
  const airport = await lookupAirportByIata(iataCode);
  if (!airport) return { enriched: false, label: null };

  const enriched = applyAviationStackAirport(prefix, airport, meta, force);
  return { enriched, label: airport.name ?? airport.iata };
}

async function enrichAirportViaGoogle(
  endpoint: string,
  prefix: "origin" | "destination",
  meta: Record<string, unknown>,
  destination: string | null | undefined,
  force: boolean,
  telemetry: ReservationEnrichmentTelemetry,
): Promise<{ enriched: boolean; label: string | null }> {
  const nameKey = `${prefix}_name`;
  const mapsKey = `${prefix}_maps_url`;
  const needsName = force || !meta[nameKey];
  const needsMaps = force || !meta[mapsKey];
  if (!needsName && !needsMaps) {
    return { enriched: false, label: String(meta[nameKey]) };
  }

  const query = isIataCode(endpoint) ? `${endpoint} airport` : `${endpoint} airport`;
  const place = await lookupPlace(query, destination, telemetry);
  if (!place) return { enriched: false, label: meta[nameKey] ? String(meta[nameKey]) : null };

  let enriched = false;
  if (setMetaValue(meta, nameKey, place.name, force)) enriched = true;
  if (setMetaValue(meta, `${prefix}_address`, place.address, force)) enriched = true;
  if (setMetaValue(meta, mapsKey, place.mapsUrl, force)) enriched = true;
  if (setMetaValue(meta, `${prefix}_latitude`, place.latitude, force)) enriched = true;
  if (setMetaValue(meta, `${prefix}_longitude`, place.longitude, force)) enriched = true;
  if (setMetaValue(meta, `${prefix}_airport`, isIataCode(endpoint) ? endpoint.toUpperCase() : endpoint, force)) {
    enriched = true;
  }

  if (enriched && meta.enrichment_provider !== ExternalProvider.AviationStack) {
    meta.enrichment_provider = ExternalProvider.GooglePlaces;
  }

  return { enriched, label: (meta[nameKey] as string | undefined) ?? place.name };
}

async function enrichFlightEndpoint(
  endpoint: string,
  prefix: "origin" | "destination",
  meta: Record<string, unknown>,
  destination: string | null | undefined,
  options: EnrichReservationOptions,
): Promise<{ enriched: boolean; label: string | null }> {
  const force = options.force ?? false;
  const telemetry = options.telemetry ?? emptyTelemetry();
  let enriched = false;
  let label: string | null = meta[`${prefix}_name`] ? String(meta[`${prefix}_name`]) : null;

  const needsAviationStack =
    force ||
    !meta[`${prefix}_name`] ||
    meta[`${prefix}_latitude`] === null ||
    meta[`${prefix}_latitude`] === undefined;

  if (needsAviationStack && isIataCode(endpoint)) {
    const aviation = await enrichAirportViaAviationStack(endpoint, prefix, meta, force, telemetry);
    if (aviation.enriched) enriched = true;
    if (aviation.label) label = aviation.label;
  }

  const needsGoogle =
    force ||
    !meta[`${prefix}_name`] ||
    meta[`${prefix}_latitude`] === null ||
    meta[`${prefix}_latitude`] === undefined ||
    !meta[`${prefix}_maps_url`];

  if (needsGoogle) {
    const google = await enrichAirportViaGoogle(endpoint, prefix, meta, destination, force, telemetry);
    if (google.enriched) enriched = true;
    if (google.label) label = google.label;
  }

  return { enriched, label };
}

async function enrichFlightReservation(
  input: AddReservationInput,
  meta: Record<string, unknown>,
  destination?: string | null,
  options: EnrichReservationOptions = {},
): Promise<{
  enriched: boolean;
  address: string | null;
  provider: string | null;
  startAt: string | Date | null;
  endAt: string | Date | null;
  enrichmentProvider: ExternalProvider | null;
  telemetry: ReservationEnrichmentTelemetry;
}> {
  const force = options.force ?? false;
  const telemetry = options.telemetry ?? emptyTelemetry();
  let enriched = false;
  let address = input.address?.trim() ? input.address : null;
  let provider = input.provider?.trim() ? input.provider : null;
  let startAt = input.startAt ?? null;
  let endAt = input.endAt ?? null;

  const flightNumber = parseFlightNumber(input.title, meta);
  if (flightNumber && (force || telemetry.aviationStackConfigured)) {
    telemetry.aviationStackFlightRequested = true;
    const flight = await lookupFlight({
      flightIata: flightNumber,
      flightDate: flightDateFromStartAt(startAt),
    });
    if (flight) {
      telemetry.aviationStackFlightMatched = true;
      const applied = applyFlightData(flight, meta, force);
      if (applied.enriched) enriched = true;
      if ((force || !provider) && applied.provider) {
        provider = applied.provider;
        enriched = true;
      }
      if ((force || !startAt) && applied.startAt) {
        startAt = applied.startAt;
        enriched = true;
      }
      if ((force || !endAt) && applied.endAt) {
        endAt = applied.endAt;
        enriched = true;
      }
    }
  }

  const endpoints = parseFlightEndpoints(input.title, meta);
  const routeLabels: string[] = [];

  if (endpoints.origin) {
    const origin = await enrichFlightEndpoint(endpoints.origin, "origin", meta, destination, {
      force,
      telemetry,
    });
    if (origin.enriched) enriched = true;
    if (origin.label) routeLabels.push(origin.label);
  }
  if (endpoints.destination) {
    const dest = await enrichFlightEndpoint(endpoints.destination, "destination", meta, destination, {
      force,
      telemetry,
    });
    if (dest.enriched) enriched = true;
    if (dest.label) routeLabels.push(dest.label);
  }

  if ((force || !address) && routeLabels.length > 0) {
    address = routeLabels.join(" → ");
    enriched = true;
  }

  const enrichmentProvider = parseEnrichmentProvider(meta.enrichment_provider);

  return { enriched, address, provider, startAt, endAt, enrichmentProvider, telemetry };
}

async function enrichPlaceReservation(
  input: AddReservationInput,
  meta: Record<string, unknown>,
  destination: string | null | undefined,
  options: EnrichReservationOptions = {},
): Promise<{
  enriched: boolean;
  address: string | null;
  enrichmentProvider: ExternalProvider | null;
  telemetry: ReservationEnrichmentTelemetry;
}> {
  const force = options.force ?? false;
  const telemetry = options.telemetry ?? emptyTelemetry();
  let enriched = false;
  let address = input.address?.trim() ? input.address : null;

  if (force || !address) {
    const query = [input.title, input.provider].filter(Boolean).join(" ");
    const place = await lookupPlace(query, destination, telemetry);
    if (place) {
      address = place.address ?? address;
      Object.assign(meta, googlePlaceMetadata(place));
      meta.enrichment_provider = ExternalProvider.GooglePlaces;
      enriched = true;
    }
  }

  return {
    enriched,
    address,
    enrichmentProvider: enriched ? ExternalProvider.GooglePlaces : null,
    telemetry,
  };
}

async function enrichReservationFields(
  input: AddReservationInput,
  destination?: string | null,
  options: EnrichReservationOptions = {},
): Promise<EnrichedReservationFields> {
  const meta = asMetadataRecord(input.metadata);
  let enriched = false;
  let address = input.address?.trim() ? input.address : null;
  let provider = input.provider?.trim() ? input.provider : null;
  let startAt = input.startAt ?? null;
  let endAt = input.endAt ?? null;
  const type = String(input.type);
  let enrichmentProvider: ExternalProvider | null = null;
  let telemetry: ReservationEnrichmentTelemetry | undefined;

  if (type === ReservationType.Flight) {
    const flightData = await enrichFlightReservation(input, meta, destination, options);
    if (flightData.enriched) enriched = true;
    address = flightData.address ?? address;
    provider = flightData.provider ?? provider;
    startAt = flightData.startAt ?? startAt;
    endAt = flightData.endAt ?? endAt;
    enrichmentProvider = flightData.enrichmentProvider;
    telemetry = flightData.telemetry;
  } else if (options.force || !address) {
    const placeData = await enrichPlaceReservation(input, meta, destination, options);
    if (placeData.enriched) enriched = true;
    address = placeData.address ?? address;
    enrichmentProvider = placeData.enrichmentProvider;
    telemetry = placeData.telemetry;
  }

  return {
    address,
    metadata: meta as Prisma.InputJsonValue,
    enriched,
    provider,
    startAt,
    endAt,
    enrichmentProvider,
    telemetry,
  };
}

export function reservationMissingFields(reservation: Reservation, googleEnriched: boolean): string[] {
  const missing: string[] = [];
  const meta = reservation.metadata;

  if (reservation.type === ReservationType.Flight) {
    if (!metaString(meta, "origin_name") && !metaString(meta, "origin_airport")) missing.push("origin_airport");
    if (!metaString(meta, "destination_name") && !metaString(meta, "destination_airport")) {
      missing.push("destination_airport");
    }
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else if (reservation.type === ReservationType.Hotel || reservation.type === ReservationType.Campsite) {
    if (!reservation.address?.trim()) missing.push("address");
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.endAt) missing.push("end_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else if (reservation.type === ReservationType.CarRental) {
    if (!reservation.address?.trim()) missing.push("address");
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else {
    if (!reservation.address?.trim()) missing.push("address");
  }

  if (!googleEnriched && !reservation.address?.trim() && reservation.type !== ReservationType.Flight) {
    if (!missing.includes("address")) missing.push("address");
  }

  return [...new Set(missing)];
}

export async function reEnrichReservation(
  reservation: Reservation,
  destination?: string | null,
): Promise<ReEnrichReservationResult> {
  if (!isEnrichableReservationType(reservation.type)) {
    throw new Error(`Reservation type "${reservation.type}" does not support enrichment.`);
  }

  const telemetry = emptyTelemetry();
  const meta = stripReservationEnrichmentMetadata(reservation);

  let enrichedData: EnrichedReservationFields;
  try {
    enrichedData = await enrichReservationFields(
      {
        tripId: reservation.tripId,
        type: reservation.type,
        title: reservation.title,
        provider: reservation.provider,
        address: reservation.address,
        metadata: meta as Prisma.InputJsonValue,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      },
      destination,
      { force: true, telemetry },
    );
  } catch {
    return {
      reservation,
      enriched: false,
      missingFields: reservationMissingFields(reservation, false),
      enrichmentProvider: null,
      telemetry,
    };
  }

  const updated = await updateReservation(reservation.tripId, reservation.id, {
    address: enrichedData.address ?? reservation.address,
    metadata: enrichedData.metadata,
    provider: enrichedData.provider ?? reservation.provider,
    startAt: enrichedData.startAt ?? reservation.startAt,
    endAt: enrichedData.endAt ?? reservation.endAt,
  });

  const finalReservation = updated ?? reservation;
  return {
    reservation: finalReservation,
    enriched: enrichedData.enriched,
    missingFields: reservationMissingFields(finalReservation, enrichedData.enriched),
    enrichmentProvider: enrichedData.enrichmentProvider ?? null,
    telemetry: enrichedData.telemetry ?? telemetry,
  };
}

export async function saveReservationWithEnrichment(
  input: SaveReservationWithEnrichmentInput,
): Promise<SaveReservationWithEnrichmentResult> {
  const { destination, ...reservationInput } = input;

  let enrichedData: EnrichedReservationFields;
  try {
    enrichedData = await enrichReservationFields(reservationInput, destination);
  } catch {
    enrichedData = {
      address: reservationInput.address ?? null,
      metadata: reservationInput.metadata ?? {},
      enriched: false,
    };
  }

  const reservation = await addReservation({
    ...reservationInput,
    address: enrichedData.address ?? reservationInput.address ?? null,
    metadata: enrichedData.metadata,
    provider: enrichedData.provider ?? reservationInput.provider ?? null,
    startAt: enrichedData.startAt ?? reservationInput.startAt ?? null,
    endAt: enrichedData.endAt ?? reservationInput.endAt ?? null,
  });

  return {
    reservation,
    enriched: enrichedData.enriched,
    missingFields: reservationMissingFields(reservation, enrichedData.enriched),
  };
}

export async function updateReservationWithEnrichment(
  tripId: number,
  reservationId: number,
  fields: UpdateReservationFields,
  existing: Reservation,
  destination?: string | null,
): Promise<SaveReservationWithEnrichmentResult | null> {
  const shouldTryEnrich =
    fields.title !== undefined || fields.provider !== undefined || fields.address !== undefined;

  const patch: UpdateReservationFields = { ...fields };
  let enriched = false;

  const mergedAddress =
    fields.address !== undefined ? fields.address : existing.address;
  const mergedTitle = fields.title ?? existing.title;
  const mergedProvider = fields.provider !== undefined ? fields.provider : existing.provider;
  const mergedType = fields.type ?? existing.type;
  const mergedMetadata =
    fields.metadata !== undefined ? fields.metadata : (existing.metadata as Prisma.InputJsonValue);
  const mergedStartAt = fields.startAt !== undefined ? fields.startAt : existing.startAt;
  const mergedEndAt = fields.endAt !== undefined ? fields.endAt : existing.endAt;

  if (shouldTryEnrich && !mergedAddress?.trim()) {
    try {
      const enrichedData = await enrichReservationFields(
        {
          tripId,
          type: mergedType,
          title: mergedTitle,
          provider: mergedProvider,
          address: mergedAddress,
          metadata: mergedMetadata,
          startAt: mergedStartAt,
          endAt: mergedEndAt,
        },
        destination,
      );
      if (enrichedData.enriched) {
        patch.address = enrichedData.address ?? undefined;
        patch.metadata = enrichedData.metadata;
        if (enrichedData.provider && !mergedProvider?.trim()) {
          patch.provider = enrichedData.provider;
        }
        if (enrichedData.startAt && !mergedStartAt) {
          patch.startAt = enrichedData.startAt;
        }
        if (enrichedData.endAt && !mergedEndAt) {
          patch.endAt = enrichedData.endAt;
        }
        enriched = true;
      }
    } catch {
      // keep user-provided fields only
    }
  }

  const reservation = await updateReservation(tripId, reservationId, patch);
  if (!reservation) return null;

  return {
    reservation,
    enriched,
    missingFields: reservationMissingFields(reservation, enriched),
  };
}

function reEnrichResultToToolItem(result: ReEnrichReservationResult) {
  return {
    reservation_id: result.reservation.id,
    type: result.reservation.type,
    title: result.reservation.title,
    enriched: result.enriched,
    enrichment_provider: result.enrichmentProvider,
    missing_fields: result.missingFields,
    aviationstack_configured: result.telemetry.aviationStackConfigured,
    aviationstack_flight_requested: result.telemetry.aviationStackFlightRequested,
    aviationstack_flight_matched: result.telemetry.aviationStackFlightMatched,
    aviationstack_airport_requests: result.telemetry.aviationStackAirportRequests,
    google_places_requests: result.telemetry.googlePlacesRequests,
  };
}

export async function reEnrichReservations(
  reservations: Reservation[],
  destinationByTripId: Map<number, string | null>,
  options: { types?: readonly string[] } = {},
): Promise<ReEnrichReservationResult[]> {
  const allowedTypes = options.types ? new Set(options.types) : null;
  const results: ReEnrichReservationResult[] = [];
  for (const reservation of reservations) {
    if (!isEnrichableReservationType(reservation.type)) continue;
    if (allowedTypes && !allowedTypes.has(reservation.type)) continue;
    results.push(
      await reEnrichReservation(reservation, destinationByTripId.get(reservation.tripId) ?? null),
    );
  }
  return results;
}

/** @deprecated Use reEnrichReservations with types: ["flight"] */
export async function reEnrichFlightReservations(
  reservations: Reservation[],
  destinationByTripId: Map<number, string | null>,
): Promise<ReEnrichReservationResult[]> {
  return reEnrichReservations(reservations, destinationByTripId, { types: [ReservationType.Flight] });
}

export function summarizeReEnrichResults(results: ReEnrichReservationResult[]) {
  return {
    count: results.length,
    enriched_count: results.filter((result) => result.enriched).length,
    aviationstack_used_count: results.filter(
      (result) => result.enrichmentProvider === ExternalProvider.AviationStack,
    ).length,
    google_places_used_count: results.filter(
      (result) => result.enrichmentProvider === ExternalProvider.GooglePlaces,
    ).length,
    results: results.map(reEnrichResultToToolItem),
  };
}
