import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Place, Trip } from "@prisma/client";
import PDFDocument from "pdfkit";
import { config, isExportStorageConfigured } from "../config";
import { fromDate } from "../util";
import {
  getCachedExport,
  itineraryExportKey,
  materializeSingleForTelegram,
  storeExportFromFile,
} from "./exportStorage";
import { getItinerary, type ItineraryDayWithItems } from "./itinerary";
import { listPlaces } from "./places";

export interface ItineraryExportResult {
  path: string;
  cached: boolean;
}

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

function stableTripSnapshot(trip: Trip) {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: fromDate(trip.startDate),
    endDate: fromDate(trip.endDate),
    travelers: trip.travelers,
    summary: trip.summary,
    status: trip.status,
  };
}

function stableItinerarySnapshot(itinerary: ItineraryDayWithItems[]) {
  return itinerary.map((day) => ({
    dayNumber: day.dayNumber,
    date: fromDate(day.date),
    title: day.title,
    summary: day.summary,
    items: day.items.map((item) => ({
      position: item.position,
      title: item.title,
      timeBlock: item.timeBlock,
      notes: item.notes,
      isBackup: item.isBackup,
      placeId: item.placeId,
    })),
  }));
}

function stablePlacesSnapshot(places: Place[]) {
  return [...places]
    .sort((a, b) => a.id - b.id)
    .map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address,
      kidFriendly: place.kidFriendly,
      notes: place.notes,
    }));
}

export function computeItineraryExportFingerprint(
  trip: Trip,
  itinerary: ItineraryDayWithItems[],
  places: Place[],
  format: "pdf" | "csv",
): string {
  const snapshot: Record<string, unknown> = {
    format,
    trip: stableTripSnapshot(trip),
    itinerary: stableItinerarySnapshot(itinerary),
  };
  if (format === "pdf") {
    snapshot.places = stablePlacesSnapshot(places);
  }
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function dayHeader(day: ItineraryDayWithItems): string {
  const parts = [`Day ${day.dayNumber}`];
  const date = fromDate(day.date);
  if (date) parts.push(date);
  if (day.title) parts.push(day.title);
  return parts.join(" - ");
}

async function writeItineraryPdf(
  trip: Trip,
  itinerary: ItineraryDayWithItems[],
  places: Place[],
  filename: string,
): Promise<void> {
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
}

export async function exportItineraryPdf(
  trip: Trip,
  options?: { forceRefresh?: boolean },
): Promise<ItineraryExportResult> {
  const itinerary = await getItinerary(trip.id);
  const places = await listPlaces(trip.id);
  const fingerprint = computeItineraryExportFingerprint(trip, itinerary, places, "pdf");
  const s3Key = itineraryExportKey(trip.id, "pdf");

  if (isExportStorageConfigured() && !options?.forceRefresh) {
    const cached = await getCachedExport(s3Key, { expectedFingerprint: fingerprint });
    if (cached) {
      return { path: await materializeSingleForTelegram(s3Key), cached: true };
    }
  }

  const dir = ensureDataDir();
  const filename = join(dir, `${slugify(trip.title)}-${trip.id}.pdf`);
  await writeItineraryPdf(trip, itinerary, places, filename);

  if (isExportStorageConfigured()) {
    await storeExportFromFile(s3Key, filename, "application/pdf", { fingerprint });
  }

  return { path: filename, cached: false };
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportItineraryCsv(
  trip: Trip,
  options?: { forceRefresh?: boolean },
): Promise<ItineraryExportResult> {
  const itinerary = await getItinerary(trip.id);
  const places = await listPlaces(trip.id);
  const fingerprint = computeItineraryExportFingerprint(trip, itinerary, places, "csv");
  const s3Key = itineraryExportKey(trip.id, "csv");

  if (isExportStorageConfigured() && !options?.forceRefresh) {
    const cached = await getCachedExport(s3Key, { expectedFingerprint: fingerprint });
    if (cached) {
      return { path: await materializeSingleForTelegram(s3Key), cached: true };
    }
  }

  const dir = ensureDataDir();
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

  if (isExportStorageConfigured()) {
    await storeExportFromFile(s3Key, filename, "text/csv", { fingerprint });
  }

  return { path: filename, cached: false };
}
