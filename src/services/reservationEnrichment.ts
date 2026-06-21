import type { Prisma, Reservation } from "@prisma/client";
import type { GooglePlaceDetails } from "./googlePlaces";
import {
  fetchGooglePlaceDetails,
  googlePlaceMetadata,
  metaString,
  resolveGoogleExternalId,
} from "./enrichmentUtils";
import {
  addReservation,
  updateReservation,
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

function asMetadataRecord(metadata: Prisma.InputJsonValue | undefined): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }
  return {};
}

async function lookupPlace(query: string, destination?: string | null): Promise<GooglePlaceDetails | null> {
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

  const originMeta =
    metaString(metadata, "origin_airport") ??
    metaString(metadata, "origin") ??
    metaString(metadata, "departure_airport");
  const destMeta =
    metaString(metadata, "destination_airport") ??
    metaString(metadata, "destination") ??
    metaString(metadata, "arrival_airport");
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

async function enrichAirportEndpoint(
  endpoint: string,
  prefix: "origin" | "destination",
  meta: Record<string, unknown>,
  destination?: string | null,
): Promise<{ enriched: boolean; label: string | null }> {
  const nameKey = `${prefix}_name`;
  if (meta[nameKey]) {
    return { enriched: false, label: String(meta[nameKey]) };
  }

  const query = /^[A-Za-z]{3}$/.test(endpoint) ? `${endpoint} airport` : `${endpoint} airport`;
  const place = await lookupPlace(query, destination);
  if (!place) return { enriched: false, label: null };

  meta[`${prefix}_name`] = place.name;
  meta[`${prefix}_address`] = place.address;
  meta[`${prefix}_maps_url`] = place.mapsUrl;
  meta[`${prefix}_latitude`] = place.latitude;
  meta[`${prefix}_longitude`] = place.longitude;
  meta[`${prefix}_airport`] = /^[A-Za-z]{3}$/.test(endpoint) ? endpoint.toUpperCase() : endpoint;

  return { enriched: true, label: place.name };
}

async function enrichReservationFields(
  input: AddReservationInput,
  destination?: string | null,
): Promise<{ address: string | null; metadata: Prisma.InputJsonValue; enriched: boolean }> {
  const meta = asMetadataRecord(input.metadata);
  let enriched = false;
  let address = input.address?.trim() ? input.address : null;
  const type = String(input.type);

  if (type === "flight") {
    const endpoints = parseFlightEndpoints(input.title, meta);
    const routeLabels: string[] = [];

    if (endpoints.origin) {
      const origin = await enrichAirportEndpoint(endpoints.origin, "origin", meta, destination);
      if (origin.enriched) enriched = true;
      if (origin.label) routeLabels.push(origin.label);
    }
    if (endpoints.destination) {
      const dest = await enrichAirportEndpoint(endpoints.destination, "destination", meta, destination);
      if (dest.enriched) enriched = true;
      if (dest.label) routeLabels.push(dest.label);
    }

    if (!address && routeLabels.length > 0) {
      address = routeLabels.join(" → ");
    }
  } else if (!address) {
    const query = [input.title, input.provider].filter(Boolean).join(" ");
    const place = await lookupPlace(query, destination);
    if (place) {
      address = place.address;
      Object.assign(meta, googlePlaceMetadata(place));
      enriched = true;
    }
  }

  return { address, metadata: meta as Prisma.InputJsonValue, enriched };
}

export function reservationMissingFields(reservation: Reservation, googleEnriched: boolean): string[] {
  const missing: string[] = [];
  const meta = reservation.metadata;

  if (reservation.type === "flight") {
    if (!metaString(meta, "origin_name") && !metaString(meta, "origin_airport")) missing.push("origin_airport");
    if (!metaString(meta, "destination_name") && !metaString(meta, "destination_airport")) {
      missing.push("destination_airport");
    }
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else if (reservation.type === "hotel" || reservation.type === "campsite") {
    if (!reservation.address?.trim()) missing.push("address");
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.endAt) missing.push("end_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else if (reservation.type === "car_rental") {
    if (!reservation.address?.trim()) missing.push("address");
    if (!reservation.startAt) missing.push("start_at");
    if (!reservation.confirmationNumber) missing.push("confirmation_number");
  } else {
    if (!reservation.address?.trim()) missing.push("address");
  }

  if (!googleEnriched && !reservation.address?.trim() && reservation.type !== "flight") {
    if (!missing.includes("address")) missing.push("address");
  }

  return [...new Set(missing)];
}

export async function saveReservationWithEnrichment(
  input: SaveReservationWithEnrichmentInput,
): Promise<SaveReservationWithEnrichmentResult> {
  const { destination, ...reservationInput } = input;

  let enrichedData: { address: string | null; metadata: Prisma.InputJsonValue; enriched: boolean };
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
        },
        destination,
      );
      if (enrichedData.enriched) {
        patch.address = enrichedData.address ?? undefined;
        patch.metadata = enrichedData.metadata;
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
