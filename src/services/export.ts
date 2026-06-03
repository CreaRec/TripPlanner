import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Trip } from "@prisma/client";
import PDFDocument from "pdfkit";
import { config } from "../config";
import { fromDate } from "../util";
import { getItinerary, type ItineraryDayWithItems } from "./itinerary";
import { listPlaces } from "./places";

function ensureDataDir(): string {
  const dir = resolve(config.dataDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "trip"
  );
}

function dayHeader(day: ItineraryDayWithItems): string {
  const parts = [`Day ${day.dayNumber}`];
  const date = fromDate(day.date);
  if (date) parts.push(date);
  if (day.title) parts.push(day.title);
  return parts.join(" - ");
}

export async function exportItineraryPdf(trip: Trip): Promise<string> {
  const dir = ensureDataDir();
  const itinerary = await getItinerary(trip.id);
  const places = await listPlaces(trip.id);
  const filename = join(dir, `${slugify(trip.title)}-${trip.id}.pdf`);

  await new Promise<void>((resolvePromise, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(filename);
    stream.on("finish", () => resolvePromise());
    stream.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(22).text(trip.title);
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#555");
    const meta: string[] = [];
    if (trip.destination) meta.push(trip.destination);
    if (trip.startDate || trip.endDate) {
      meta.push(`${fromDate(trip.startDate) ?? "?"} -> ${fromDate(trip.endDate) ?? "?"}`);
    }
    if (trip.travelers) meta.push(`Travelers: ${trip.travelers}`);
    if (meta.length > 0) doc.text(meta.join("  |  "));
    if (trip.summary) {
      doc.moveDown(0.5).fillColor("#000").fontSize(12).text(trip.summary);
    }
    doc.fillColor("#000");

    doc.moveDown(1).fontSize(16).text("Itinerary");
    doc.moveDown(0.3);
    if (itinerary.length === 0) {
      doc.fontSize(11).fillColor("#777").text("No itinerary days yet.").fillColor("#000");
    }
    for (const day of itinerary) {
      doc.moveDown(0.5).fontSize(13).text(dayHeader(day));
      if (day.summary) doc.fontSize(10).fillColor("#555").text(day.summary).fillColor("#000");
      doc.fontSize(11);
      if (day.items.length === 0) {
        doc.fillColor("#777").text("  (no items)").fillColor("#000");
      }
      for (const item of day.items) {
        const prefix = item.isBackup ? "  [backup] " : "  - ";
        const time = item.timeBlock ? `${item.timeBlock}: ` : "";
        doc.text(`${prefix}${time}${item.title}`);
        if (item.notes) {
          doc.fontSize(9).fillColor("#666").text(`      ${item.notes}`).fontSize(11).fillColor("#000");
        }
      }
    }

    if (places.length > 0) {
      doc.moveDown(1).fontSize(16).text("Saved places");
      doc.moveDown(0.3).fontSize(11);
      for (const place of places) {
        const tags: string[] = [];
        if (place.category) tags.push(place.category);
        if (place.kidFriendly) tags.push("kid-friendly");
        const suffix = tags.length > 0 ? ` (${tags.join(", ")})` : "";
        doc.text(`  - ${place.name}${suffix}`);
        if (place.notes) {
          doc.fontSize(9).fillColor("#666").text(`      ${place.notes}`).fontSize(11).fillColor("#000");
        }
      }
    }

    doc.end();
  });

  return filename;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportItineraryCsv(trip: Trip): Promise<string> {
  const dir = ensureDataDir();
  const itinerary = await getItinerary(trip.id);
  const filename = join(dir, `${slugify(trip.title)}-${trip.id}.csv`);

  const header = ["day_number", "date", "day_title", "position", "time_block", "item", "is_backup", "notes"];
  const lines = [header.map(csvCell).join(",")];

  for (const day of itinerary) {
    const date = fromDate(day.date);
    if (day.items.length === 0) {
      lines.push([day.dayNumber, date, day.title, "", "", "", "", day.summary].map(csvCell).join(","));
      continue;
    }
    for (const item of day.items) {
      lines.push(
        [day.dayNumber, date, day.title, item.position, item.timeBlock, item.title, item.isBackup, item.notes]
          .map(csvCell)
          .join(","),
      );
    }
  }

  writeFileSync(filename, lines.join("\n"), "utf8");
  return filename;
}
