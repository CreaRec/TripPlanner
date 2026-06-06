import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config, isExportStorageConfigured } from "../config";
import {
  getCachedExport,
  hashRouteMapInput,
  materializeSingleForTelegram,
  routeMapExportKey,
  storeExportObject,
} from "./exportStorage";
import {
  decodeEncodedPolyline,
  encodePolyline,
  simplifyPolyline,
  type LatLng,
} from "./routeGeometry";

const STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap";
const MAX_STATIC_MAPS_URL_LENGTH = 15_000;
const SIMPLIFICATION_TOLERANCES_METERS = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 20_000];

type FetchLike = typeof fetch;

export interface RouteComparisonMapInput {
  origin: string;
  destination: string;
  stopName: string;
  startLocation: LatLng;
  stopLocation: LatLng;
  endLocation: LatLng;
  baseEncodedPolyline: string;
  detourEncodedPolyline: string;
  detourDurationSeconds: number;
  detourDistanceMeters: number;
  apiKey?: string;
  fetchImpl?: FetchLike;
  width?: number;
  height?: number;
  filenamePrefix?: string;
  forceRefresh?: boolean;
}

function requireApiKey(apiKey = config.googleMapsApiKey): string {
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required to generate Static Maps images.");
  }
  return apiKey;
}

export function isStaticMapsConfigured(): boolean {
  return Boolean(config.googleMapsApiKey);
}

function ensureDataDir(): string {
  const dir = resolve(config.dataDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "route-map"
  );
}

function formatLatLng(point: LatLng): string {
  return `${point.latitude},${point.longitude}`;
}

function detourLabel(input: Pick<RouteComparisonMapInput, "detourDurationSeconds" | "detourDistanceMeters">): string {
  const minutes = Math.round(input.detourDurationSeconds / 60);
  const km = Math.round((input.detourDistanceMeters / 1000) * 10) / 10;
  return `+${minutes} min / +${km} km`;
}

function buildUrl(input: RouteComparisonMapInput, baseEncodedPolyline: string, detourEncodedPolyline: string): string {
  const key = requireApiKey(input.apiKey);
  const params = new URLSearchParams();
  params.set("size", `${input.width ?? 900}x${input.height ?? 600}`);
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  // Draw the detour first and the direct route on top so different highways stay visible.
  params.append("path", `color:0x0066ffff|weight:6|enc:${detourEncodedPolyline}`);
  params.append("path", `color:0xff6600ff|weight:4|enc:${baseEncodedPolyline}`);
  params.append("markers", `color:green|label:A|${formatLatLng(input.startLocation)}`);
  params.append("markers", `color:blue|label:B|${formatLatLng(input.stopLocation)}`);
  params.append("markers", `color:red|label:C|${formatLatLng(input.endLocation)}`);
  params.set("key", key);
  return `${STATIC_MAPS_URL}?${params.toString()}`;
}

function simplifiedEncodedPolyline(encoded: string, toleranceMeters: number): string {
  const points = decodeEncodedPolyline(encoded);
  return encodePolyline(simplifyPolyline(points, toleranceMeters));
}

export function buildRouteComparisonStaticMapUrl(input: RouteComparisonMapInput): string {
  const originalUrl = buildUrl(input, input.baseEncodedPolyline, input.detourEncodedPolyline);
  if (originalUrl.length <= MAX_STATIC_MAPS_URL_LENGTH) return originalUrl;

  let shortestUrl = originalUrl;
  for (const tolerance of SIMPLIFICATION_TOLERANCES_METERS) {
    const base = simplifiedEncodedPolyline(input.baseEncodedPolyline, tolerance);
    const detour = simplifiedEncodedPolyline(input.detourEncodedPolyline, tolerance);
    const url = buildUrl(input, base, detour);
    if (url.length < shortestUrl.length) shortestUrl = url;
    if (url.length <= MAX_STATIC_MAPS_URL_LENGTH) return url;
  }
  return shortestUrl;
}

export async function generateRouteComparisonMap(input: RouteComparisonMapInput): Promise<string> {
  const routeHash = hashRouteMapInput(input);
  const s3Key = routeMapExportKey(routeHash);

  if (isExportStorageConfigured() && !input.forceRefresh) {
    const cached = await getCachedExport(s3Key);
    if (cached) {
      return materializeSingleForTelegram(s3Key);
    }
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const url = buildRouteComparisonStaticMapUrl(input);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Google Static Maps API request failed (${response.status}): ${await response.text()}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (isExportStorageConfigured()) {
    await storeExportObject(s3Key, bytes, "image/png");
    return materializeSingleForTelegram(s3Key);
  }

  const dir = ensureDataDir();
  const filename = join(
    dir,
    `${slugify(input.filenamePrefix ?? `${input.origin}-${input.stopName}-${input.destination}`)}-${routeHash.slice(0, 12)}.png`,
  );
  writeFileSync(filename, bytes);
  return filename;
}

export function routeComparisonMapCaption(input: RouteComparisonMapInput): string {
  return `${input.stopName}: ${detourLabel(input)}`;
}
