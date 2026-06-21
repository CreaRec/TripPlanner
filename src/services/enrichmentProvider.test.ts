import { describe, expect, it } from "vitest";
import {
  EnrichmentProvider,
  isEnrichmentProvider,
  parseEnrichmentProvider,
} from "./enrichmentProvider";

describe("EnrichmentProvider", () => {
  it("recognizes known provider values", () => {
    expect(isEnrichmentProvider(EnrichmentProvider.AviationStack)).toBe(true);
    expect(isEnrichmentProvider(EnrichmentProvider.GooglePlaces)).toBe(true);
    expect(parseEnrichmentProvider("google_places")).toBe(EnrichmentProvider.GooglePlaces);
  });

  it("rejects unknown values", () => {
    expect(isEnrichmentProvider("unknown")).toBe(false);
    expect(parseEnrichmentProvider("unknown")).toBeNull();
  });
});
