import { config } from "../../config";
import { searchGooglePlaces } from "./googlePlaces";
import type { LatLng } from "./routeGeometry";

const WEATHER_BASE_URL = "https://weather.googleapis.com/v1";

type FetchLike = typeof fetch;
type UnitsSystem = "METRIC" | "IMPERIAL";

interface GoogleLocalizedText {
  text?: string;
  languageCode?: string;
}

interface GoogleTemperature {
  degrees?: number;
  unit?: string;
}

interface GoogleWeatherCondition {
  description?: GoogleLocalizedText;
  type?: string;
}

interface GoogleWindSpeed {
  value?: number;
  unit?: string;
}

interface GoogleWind {
  direction?: { cardinal?: string; degrees?: number };
  speed?: GoogleWindSpeed;
  gust?: GoogleWindSpeed;
}

interface GooglePrecipitationProbability {
  percent?: number;
  type?: string;
}

interface GoogleCurrentConditionsResponse {
  currentTime?: string;
  timeZone?: { id?: string };
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: { probability?: GooglePrecipitationProbability };
  wind?: GoogleWind;
  isDaytime?: boolean;
}

interface GoogleDailyForecastDay {
  displayDate?: { year?: number; month?: number; day?: number };
  maxTemperature?: GoogleTemperature;
  minTemperature?: GoogleTemperature;
  daytimeForecast?: {
    weatherCondition?: GoogleWeatherCondition;
    precipitation?: { probability?: GooglePrecipitationProbability };
  };
  nighttimeForecast?: {
    weatherCondition?: GoogleWeatherCondition;
    precipitation?: { probability?: GooglePrecipitationProbability };
  };
}

interface GoogleDailyForecastResponse {
  timeZone?: { id?: string };
  forecastDays?: GoogleDailyForecastDay[];
}

interface GoogleApiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface WeatherClientOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export interface GetWeatherInput extends WeatherClientOptions {
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Number of daily forecast days (0 = current conditions only). */
  forecastDays?: number;
  unitsSystem?: UnitsSystem;
}

export interface ResolvedWeatherLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export interface WeatherCurrentSummary {
  observed_at: string | null;
  description: string | null;
  temperature: string | null;
  feels_like: string | null;
  relative_humidity_percent: number | null;
  uv_index: number | null;
  precipitation_chance_percent: number | null;
  precipitation_type: string | null;
  wind: string | null;
  is_daytime: boolean | null;
}

export interface WeatherDailySummary {
  date: string;
  description: string | null;
  high: string | null;
  low: string | null;
  daytime_precipitation_chance_percent: number | null;
  nighttime_precipitation_chance_percent: number | null;
}

export interface WeatherSummary {
  location: ResolvedWeatherLocation;
  time_zone: string | null;
  units_system: UnitsSystem;
  current: WeatherCurrentSummary | null;
  forecast_days: WeatherDailySummary[];
}

function requireApiKey(apiKey = config.googleMapsApiKey): string {
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required to fetch weather (enable Weather API on the key).");
  }
  return apiKey;
}

export function isWeatherConfigured(): boolean {
  return Boolean(config.googleMapsApiKey);
}

function formatTemperature(value: GoogleTemperature | undefined): string | null {
  if (value?.degrees === undefined) return null;
  const unit = value.unit === "FAHRENHEIT" ? "°F" : "°C";
  return `${Math.round(value.degrees * 10) / 10}${unit}`;
}

function formatWind(wind: GoogleWind | undefined): string | null {
  if (!wind?.speed?.value) return null;
  const speedUnit = wind.speed.unit === "MILES_PER_HOUR" ? "mph" : "km/h";
  const gust =
    wind.gust?.value !== undefined
      ? `, gusts ${Math.round(wind.gust.value)} ${wind.gust.unit === "MILES_PER_HOUR" ? "mph" : "km/h"}`
      : "";
  const direction = wind.direction?.cardinal ? ` ${wind.direction.cardinal}` : "";
  return `${Math.round(wind.speed.value)} ${speedUnit}${direction}${gust}`;
}

function weatherDescription(condition: GoogleWeatherCondition | undefined): string | null {
  return condition?.description?.text ?? condition?.type ?? null;
}

function formatGoogleApiError(body: string): string {
  try {
    const parsed = JSON.parse(body) as GoogleApiErrorResponse;
    const error = parsed.error;
    if (!error) return body;
    return [error.status ? `status=${error.status}` : null, error.message ? `message=${error.message}` : null]
      .filter(Boolean)
      .join(" ");
  } catch {
    return body;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Weather API request failed (${response.status}): ${formatGoogleApiError(body)}`);
  }
  return (await response.json()) as T;
}

function buildLookupParams(coords: LatLng, unitsSystem: UnitsSystem, apiKey: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("key", apiKey);
  params.set("location.latitude", String(coords.latitude));
  params.set("location.longitude", String(coords.longitude));
  params.set("unitsSystem", unitsSystem);
  return params;
}

async function fetchCurrentConditions(
  coords: LatLng,
  unitsSystem: UnitsSystem,
  options: WeatherClientOptions,
): Promise<GoogleCurrentConditionsResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = buildLookupParams(coords, unitsSystem, requireApiKey(options.apiKey));
  const response = await fetchImpl(`${WEATHER_BASE_URL}/currentConditions:lookup?${params.toString()}`);
  return parseJson<GoogleCurrentConditionsResponse>(response);
}

async function fetchDailyForecast(
  coords: LatLng,
  unitsSystem: UnitsSystem,
  days: number,
  options: WeatherClientOptions,
): Promise<GoogleDailyForecastResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = buildLookupParams(coords, unitsSystem, requireApiKey(options.apiKey));
  params.set("days", String(days));
  const response = await fetchImpl(`${WEATHER_BASE_URL}/forecast/days:lookup?${params.toString()}`);
  return parseJson<GoogleDailyForecastResponse>(response);
}

function summarizeCurrent(response: GoogleCurrentConditionsResponse): WeatherCurrentSummary {
  return {
    observed_at: response.currentTime ?? null,
    description: weatherDescription(response.weatherCondition),
    temperature: formatTemperature(response.temperature),
    feels_like: formatTemperature(response.feelsLikeTemperature),
    relative_humidity_percent: response.relativeHumidity ?? null,
    uv_index: response.uvIndex ?? null,
    precipitation_chance_percent: response.precipitation?.probability?.percent ?? null,
    precipitation_type: response.precipitation?.probability?.type ?? null,
    wind: formatWind(response.wind),
    is_daytime: response.isDaytime ?? null,
  };
}

function formatDisplayDate(day: GoogleDailyForecastDay): string {
  const date = day.displayDate;
  if (!date?.year || !date.month || !date.day) return "unknown";
  const month = String(date.month).padStart(2, "0");
  const dayOfMonth = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${dayOfMonth}`;
}

function summarizeForecastDays(response: GoogleDailyForecastResponse): WeatherDailySummary[] {
  return (response.forecastDays ?? []).map((day) => ({
    date: formatDisplayDate(day),
    description: weatherDescription(day.daytimeForecast?.weatherCondition),
    high: formatTemperature(day.maxTemperature),
    low: formatTemperature(day.minTemperature),
    daytime_precipitation_chance_percent: day.daytimeForecast?.precipitation?.probability?.percent ?? null,
    nighttime_precipitation_chance_percent: day.nighttimeForecast?.precipitation?.probability?.percent ?? null,
  }));
}

export async function resolveWeatherLocation(input: GetWeatherInput): Promise<ResolvedWeatherLocation> {
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if (latitude !== null && longitude !== null) {
    const label = input.location?.trim() || `${latitude}, ${longitude}`;
    return { label, latitude, longitude };
  }

  const query = input.location?.trim();
  if (!query) {
    throw new Error("A location name or latitude/longitude is required for weather.");
  }

  const places = await searchGooglePlaces(query, {
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    maxResults: 1,
  });
  const place = places.find((p) => p.latitude !== null && p.longitude !== null);
  if (!place || place.latitude === null || place.longitude === null) {
    throw new Error(`Could not find coordinates for "${query}". Try a more specific place or city.`);
  }

  return {
    label: place.address ? `${place.name} (${place.address})` : place.name,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

export async function getWeather(input: GetWeatherInput): Promise<WeatherSummary> {
  const unitsSystem = input.unitsSystem ?? "METRIC";
  const forecastDays = Math.min(10, Math.max(0, input.forecastDays ?? 3));
  const location = await resolveWeatherLocation(input);
  const coords: LatLng = { latitude: location.latitude, longitude: location.longitude };

  const [currentResponse, forecastResponse] = await Promise.all([
    fetchCurrentConditions(coords, unitsSystem, input),
    forecastDays > 0
      ? fetchDailyForecast(coords, unitsSystem, forecastDays, input)
      : Promise.resolve(null),
  ]);

  return {
    location,
    time_zone: currentResponse.timeZone?.id ?? forecastResponse?.timeZone?.id ?? null,
    units_system: unitsSystem,
    current: summarizeCurrent(currentResponse),
    forecast_days: forecastResponse ? summarizeForecastDays(forecastResponse) : [],
  };
}
