import { config } from "../config";

const AVIATIONSTACK_BASE_URL = "https://api.aviationstack.com/v1";
import { EnrichmentProvider } from "./enrichmentProvider";

type FetchLike = typeof fetch;

export interface AviationStackClientOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export interface AviationStackFlightEndpoint {
  airport: string | null;
  iata: string | null;
  icao: string | null;
  terminal: string | null;
  gate: string | null;
  scheduled: string | null;
  estimated: string | null;
  delay: number | null;
}

export interface AviationStackFlight {
  flightDate: string | null;
  flightStatus: string | null;
  airlineName: string | null;
  airlineIata: string | null;
  flightIata: string | null;
  flightNumber: string | null;
  departure: AviationStackFlightEndpoint;
  arrival: AviationStackFlightEndpoint;
}

export interface AviationStackAirport {
  iata: string | null;
  icao: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface AviationStackFlightEndpointRaw {
  airport?: string;
  iata?: string;
  icao?: string;
  terminal?: string | null;
  gate?: string | null;
  scheduled?: string;
  estimated?: string;
  delay?: number | null;
}

interface AviationStackFlightRaw {
  flight_date?: string;
  flight_status?: string;
  departure?: AviationStackFlightEndpointRaw;
  arrival?: AviationStackFlightEndpointRaw;
  airline?: { name?: string; iata?: string; icao?: string };
  flight?: { number?: string; iata?: string; icao?: string };
}

interface AviationStackAirportRaw {
  iata_code?: string;
  icao_code?: string;
  airport_name?: string;
  city_iata?: string;
  country_name?: string;
  latitude?: string | number;
  longitude?: string | number;
}

interface AviationStackListResponse<T> {
  data?: T[];
  error?: { code?: string; message?: string; type?: string };
}

function optionalApiKey(apiKey = config.aviationStackApiKey): string | null {
  const key = apiKey?.trim();
  return key ? key : null;
}

function toFlightEndpoint(raw: AviationStackFlightEndpointRaw | undefined): AviationStackFlightEndpoint {
  return {
    airport: raw?.airport ?? null,
    iata: raw?.iata ?? null,
    icao: raw?.icao ?? null,
    terminal: raw?.terminal ?? null,
    gate: raw?.gate ?? null,
    scheduled: raw?.scheduled ?? null,
    estimated: raw?.estimated ?? null,
    delay: raw?.delay ?? null,
  };
}

function toFlight(raw: AviationStackFlightRaw): AviationStackFlight {
  return {
    flightDate: raw.flight_date ?? null,
    flightStatus: raw.flight_status ?? null,
    airlineName: raw.airline?.name ?? null,
    airlineIata: raw.airline?.iata ?? null,
    flightIata: raw.flight?.iata ?? null,
    flightNumber: raw.flight?.number ?? null,
    departure: toFlightEndpoint(raw.departure),
    arrival: toFlightEndpoint(raw.arrival),
  };
}

function parseCoordinate(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toAirport(raw: AviationStackAirportRaw): AviationStackAirport {
  return {
    iata: raw.iata_code ?? null,
    icao: raw.icao_code ?? null,
    name: raw.airport_name ?? null,
    city: raw.city_iata ?? null,
    country: raw.country_name ?? null,
    latitude: parseCoordinate(raw.latitude),
    longitude: parseCoordinate(raw.longitude),
  };
}

async function fetchAviationStack<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  options: AviationStackClientOptions = {},
): Promise<AviationStackListResponse<T> | null> {
  const apiKey = optionalApiKey(options.apiKey);
  if (!apiKey) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(`${AVIATIONSTACK_BASE_URL}/${path}`);
  url.searchParams.set("access_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetchImpl(url.toString(), { method: "GET" });
    if (!response.ok) return null;
    const body = (await response.json()) as AviationStackListResponse<T>;
    if (body.error) return null;
    return body;
  } catch {
    return null;
  }
}

export interface LookupFlightParams {
  flightIata: string;
  flightDate?: string | null;
}

export async function lookupFlight(
  params: LookupFlightParams,
  options: AviationStackClientOptions = {},
): Promise<AviationStackFlight | null> {
  const flightIata = params.flightIata.trim().toUpperCase();
  if (!flightIata) return null;

  const body = await fetchAviationStack<AviationStackFlightRaw>(
    "flights",
    {
      flight_iata: flightIata,
      flight_date: params.flightDate ?? undefined,
      limit: 1,
    },
    options,
  );
  const raw = body?.data?.[0];
  return raw ? toFlight(raw) : null;
}

export async function lookupAirportByIata(
  iataCode: string,
  options: AviationStackClientOptions = {},
): Promise<AviationStackAirport | null> {
  const iata = iataCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) return null;

  const body = await fetchAviationStack<AviationStackAirportRaw>(
    "airports",
    {
      iata_code: iata,
      limit: 1,
    },
    options,
  );
  const raw = body?.data?.[0];
  return raw ? toAirport(raw) : null;
}
