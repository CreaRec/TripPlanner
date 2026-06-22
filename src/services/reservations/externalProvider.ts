export enum ExternalProvider {
  GooglePlaces = "google_places",
  GoogleGmail = "google_gmail",
  AviationStack = "aviationstack",
}

export function isExternalProvider(value: unknown): value is ExternalProvider {
  return (
    value === ExternalProvider.GooglePlaces ||
    value === ExternalProvider.GoogleGmail ||
    value === ExternalProvider.AviationStack
  );
}

export function parseExternalProvider(value: unknown): ExternalProvider | null {
  return isExternalProvider(value) ? value : null;
}

export function isEnrichmentProvider(value: unknown): value is ExternalProvider {
  return (
    value === ExternalProvider.AviationStack || value === ExternalProvider.GooglePlaces
  );
}

export function parseEnrichmentProvider(value: unknown): ExternalProvider | null {
  return isEnrichmentProvider(value) ? value : null;
}

/** @deprecated Use ExternalProvider */
export const EnrichmentProvider = ExternalProvider;
