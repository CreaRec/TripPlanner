import { describe, expect, it } from "vitest";
import {
  ExternalProvider,
  isEnrichmentProvider,
  isExternalProvider,
  parseEnrichmentProvider,
  parseExternalProvider,
} from "./externalProvider";

describe("ExternalProvider", () => {
  it("recognizes known provider values", () => {
    expect(isExternalProvider(ExternalProvider.GooglePlaces)).toBe(true);
    expect(isExternalProvider(ExternalProvider.GoogleGmail)).toBe(true);
    expect(isExternalProvider(ExternalProvider.AviationStack)).toBe(true);
    expect(parseExternalProvider("google_gmail")).toBe(ExternalProvider.GoogleGmail);
  });

  it("recognizes enrichment providers", () => {
    expect(isEnrichmentProvider(ExternalProvider.AviationStack)).toBe(true);
    expect(isEnrichmentProvider(ExternalProvider.GooglePlaces)).toBe(true);
    expect(isEnrichmentProvider(ExternalProvider.GoogleGmail)).toBe(false);
    expect(parseEnrichmentProvider("google_places")).toBe(ExternalProvider.GooglePlaces);
  });

  it("rejects unknown values", () => {
    expect(isExternalProvider("unknown")).toBe(false);
    expect(parseExternalProvider("unknown")).toBeNull();
  });
});
