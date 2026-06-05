import { describe, expect, it } from "vitest";
import { slugifyEmailFilename } from "./gmailExport";

describe("slugifyEmailFilename", () => {
  it("slugifies subjects for safe filenames", () => {
    expect(slugifyEmailFilename("Hotel Booking — Paris!")).toBe("hotel-booking-paris");
    expect(slugifyEmailFilename("")).toBe("email");
  });
});
