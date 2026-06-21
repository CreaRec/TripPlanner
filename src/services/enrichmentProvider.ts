export enum EnrichmentProvider {
  AviationStack = "aviationstack",
  GooglePlaces = "google_places",
}

export function isEnrichmentProvider(value: unknown): value is EnrichmentProvider {
  return (
    value === EnrichmentProvider.AviationStack || value === EnrichmentProvider.GooglePlaces
  );
}

export function parseEnrichmentProvider(value: unknown): EnrichmentProvider | null {
  return isEnrichmentProvider(value) ? value : null;
}
