import { describe, expect, it } from "vitest";
import { fromDate, toDate } from "./util";

describe("toDate", () => {
  it("parses an ISO date string to UTC midnight", () => {
    const d = toDate("2026-07-01");
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("returns null for null/undefined/empty", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
  });

  it("returns null for an invalid date string", () => {
    expect(toDate("not-a-date")).toBeNull();
  });

  it("accepts a full ISO datetime string", () => {
    const d = toDate("2026-07-01T12:30:00Z");
    expect(d?.toISOString()).toBe("2026-07-01T12:30:00.000Z");
  });
});

describe("fromDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    expect(fromDate(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07-01");
  });

  it("returns null for null/undefined", () => {
    expect(fromDate(null)).toBeNull();
    expect(fromDate(undefined)).toBeNull();
  });

  it("round-trips with toDate", () => {
    expect(fromDate(toDate("2026-12-25"))).toBe("2026-12-25");
  });
});
