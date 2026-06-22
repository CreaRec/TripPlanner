import { describe, expect, it } from "vitest";
import {
  isEnrichableReservationType,
  isReservationType,
  parseReservationType,
  ReservationType,
} from "./reservationType";

describe("ReservationType", () => {
  it("recognizes reservation types", () => {
    expect(isReservationType(ReservationType.Flight)).toBe(true);
    expect(parseReservationType("hotel")).toBe(ReservationType.Hotel);
  });

  it("flags enrichable reservation types", () => {
    expect(isEnrichableReservationType(ReservationType.Flight)).toBe(true);
    expect(isEnrichableReservationType("unknown")).toBe(false);
  });
});
