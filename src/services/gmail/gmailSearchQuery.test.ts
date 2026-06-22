import { describe, expect, it } from "vitest";
import { buildGmailSearchQuery } from "./gmailSearchQuery";

describe("buildGmailSearchQuery", () => {
  it("builds a query from trip dates and destination", () => {
    const q = buildGmailSearchQuery({
      trip: {
        title: "Paris spring",
        destination: "Paris",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-10"),
      },
    });
    expect(q).toContain("after:2026/06/01");
    expect(q).toContain("before:2026/06/10");
    expect(q).toContain("Paris");
  });

  it("includes reservation confirmation and provider", () => {
    const q = buildGmailSearchQuery({
      reservation: {
        title: "Hotel Le Marais",
        provider: "booking.com",
        confirmationNumber: "ABC123",
        startAt: new Date("2026-06-02T15:00:00Z"),
        endAt: new Date("2026-06-05T11:00:00Z"),
        address: null,
      },
    });
    expect(q).toContain("ABC123");
    expect(q).toContain("booking.com");
    expect(q).toContain("Hotel Le Marais");
  });

  it("merges user query with place name", () => {
    const q = buildGmailSearchQuery({
      userQuery: "flight confirmation",
      place: { name: "Louvre", address: "Paris, France" },
    });
    expect(q).toContain("flight confirmation");
    expect(q).toContain("Louvre");
    expect(q).toContain("Paris, France");
  });
});
