import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = join(import.meta.dirname, "trip-planner");

const pages = [
  {
    file: "index.html",
    title: "Crea Trip Planner",
    h1: "Crea Trip Planner",
    crossLinks: ["/trip-planner/privacy/", "/trip-planner/terms/"],
  },
  {
    file: join("privacy", "index.html"),
    title: "Privacy Policy — Crea Trip Planner",
    h1: "Privacy Policy",
    crossLinks: ["/trip-planner/", "/trip-planner/terms/"],
  },
  {
    file: join("terms", "index.html"),
    title: "Terms of Service — Crea Trip Planner",
    h1: "Terms of Service",
    crossLinks: ["/trip-planner/", "/trip-planner/privacy/"],
  },
] as const;

describe("trip-planner static pages", () => {
  for (const page of pages) {
    const path = join(webRoot, page.file);

    it(`exists: ${page.file}`, () => {
      expect(existsSync(path)).toBe(true);
    });

    it(`has title and h1: ${page.file}`, () => {
      const html = readFileSync(path, "utf8");
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain(`<h1>${page.h1}</h1>`);
    });

    it(`links to related pages: ${page.file}`, () => {
      const html = readFileSync(path, "utf8");
      for (const href of page.crossLinks) {
        expect(html).toContain(`href="${href}"`);
      }
    });
  }

  it("shared stylesheet exists", () => {
    expect(existsSync(join(webRoot, "assets", "styles.css"))).toBe(true);
  });
});
