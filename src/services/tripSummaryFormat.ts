import type { Reservation, Trip } from "@prisma/client";
import type { ItineraryDayWithItems } from "./itinerary";
import { fromDate } from "../util";

export type TripSummaryFormat = "card" | "by_day";
export type TripSummaryLocale = "en" | "ru";

export interface TripSummaryMemory {
  content: string;
}

export interface FormatTripSummaryInput {
  trip: Trip;
  itinerary: ItineraryDayWithItems[];
  reservations: Reservation[];
  memories?: TripSummaryMemory[];
  format: TripSummaryFormat;
  locale?: TripSummaryLocale;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const LABELS = {
  en: {
    transport: "Transport",
    hotel: "Hotel",
    plan: "Plan",
    notes: "Notes",
    checkIn: "check-in",
    checkOut: "check-out",
    pickup: "pickup",
    return: "return",
    seat: "seat",
    conf: "conf",
    day: "Day",
    stay: "stay",
  },
  ru: {
    transport: "Транспорт",
    hotel: "Отель",
    plan: "План",
    notes: "Важные заметки",
    checkIn: "заезд",
    checkOut: "выезд",
    pickup: "получение",
    return: "возврат",
    seat: "seat",
    conf: "conf",
    day: "Day",
    stay: "ночь",
  },
} as const;

function labels(locale: TripSummaryLocale) {
  return LABELS[locale];
}

function parseIsoDate(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m, d };
}

function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function formatShortDate(iso: string, locale: TripSummaryLocale): string {
  const { y, m, d } = parseIsoDate(iso);
  if (locale === "ru") {
    return `${d} ${MONTHS_RU[m - 1]}`;
  }
  return `${MONTHS_EN[m - 1]} ${d}`;
}

function formatShortDateWithYear(iso: string, locale: TripSummaryLocale): string {
  const { y, m, d } = parseIsoDate(iso);
  if (locale === "ru") {
    return `${d} ${MONTHS_RU[m - 1]} ${y}`;
  }
  return `${MONTHS_EN[m - 1]} ${d}, ${y}`;
}

export function formatDateRange(
  start: string | null,
  end: string | null,
  locale: TripSummaryLocale,
): string | null {
  if (!start && !end) return null;
  if (start && !end) return formatShortDateWithYear(start, locale);
  if (!start && end) return formatShortDateWithYear(end, locale);
  if (start === end) return formatShortDateWithYear(start!, locale);

  const s = parseIsoDate(start!);
  const e = parseIsoDate(end!);
  if (s.y === e.y && s.m === e.m) {
    if (locale === "ru") {
      return `${s.d}–${e.d} ${MONTHS_RU[s.m - 1]} ${s.y}`;
    }
    return `${MONTHS_EN[s.m - 1]} ${s.d}–${e.d}, ${s.y}`;
  }
  if (s.y === e.y) {
    if (locale === "ru") {
      return `${s.d} ${MONTHS_RU[s.m - 1]} – ${e.d} ${MONTHS_RU[e.m - 1]} ${s.y}`;
    }
    return `${MONTHS_EN[s.m - 1]} ${s.d} – ${MONTHS_EN[e.m - 1]} ${e.d}, ${s.y}`;
  }
  return `${formatShortDateWithYear(start!, locale)} – ${formatShortDateWithYear(end!, locale)}`;
}

function metaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function flightCode(reservation: Reservation): string | null {
  const text = [
    reservation.provider,
    reservation.title,
    metaString(reservation.metadata, "flight_number"),
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\b([A-Z0-9]{2})\s*(\d{1,4})\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

function reservationRichness(reservation: Reservation): number {
  let score = reservation.title.length;
  if (reservation.provider) score += 10;
  if (reservation.confirmationNumber) score += 5;
  if (reservation.address) score += 3;
  if (metaString(reservation.metadata, "seat")) score += 2;
  if (reservation.notes) score += 1;
  if (/→| to |—|-\s*\w{3}/i.test(reservation.title)) score += 5;
  return score;
}

function normalizeRoute(title: string): string {
  return title
    .toLowerCase()
    .replace(/alaska airlines?/gi, "")
    .replace(/\bas\b/gi, "")
    .replace(/\b[A-Z0-9]{2}\s*\d{1,4}\b/gi, "")
    .replace(/[→—–\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameFlightDirection(a: Reservation, b: Reservation): boolean {
  const routeA = normalizeRoute(a.title);
  const routeB = normalizeRoute(b.title);
  if (!routeA || !routeB) return true;
  return routeA === routeB;
}

function shouldMergeReservations(a: Reservation, b: Reservation): boolean {
  if (a.type !== b.type) return false;

  const confA = a.confirmationNumber?.trim().toUpperCase();
  const confB = b.confirmationNumber?.trim().toUpperCase();

  if (a.type === "flight") {
    const codeA = flightCode(a);
    const codeB = flightCode(b);
    if (!codeA || codeA !== codeB) return false;

    const dateA = dateOnly(a.startAt);
    const dateB = dateOnly(b.startAt);
    if (dateA && dateB && dateA === dateB) return true;

    return sameFlightDirection(a, b);
  }

  if (confA && confB && confA === confB) return true;

  if (a.type === "hotel" || a.type === "car_rental") {
    if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) return true;
  }

  return false;
}

function pickBetterReservation(a: Reservation, b: Reservation): Reservation {
  const scoreA = reservationRichness(a);
  const scoreB = reservationRichness(b);
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  return a.id < b.id ? a : b;
}

export function dedupeReservations(reservations: Reservation[]): Reservation[] {
  const kept: Reservation[] = [];

  for (const reservation of reservations) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      if (shouldMergeReservations(kept[i], reservation)) {
        kept[i] = pickBetterReservation(kept[i], reservation);
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(reservation);
  }

  return kept.sort((a, b) => {
    const dateA = a.startAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const dateB = b.startAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return dateA - dateB || a.id - b.id;
  });
}

function providerAlreadyInTitle(provider: string, title: string): boolean {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle.includes(normalizedProvider)) return true;

  const providerCode = normalizedProvider.match(/\b([a-z0-9]{2})\s*(\d{1,4})\b/i);
  const titleCode = normalizedTitle.match(/\b([a-z0-9]{2})\s*(\d{1,4})\b/i);
  if (
    providerCode &&
    titleCode &&
    providerCode[1] === titleCode[1] &&
    providerCode[2] === titleCode[2]
  ) {
    return true;
  }

  return false;
}

function memoryDuplicatesReservation(content: string, reservations: Reservation[]): boolean {
  const lower = content.toLowerCase();

  for (const reservation of reservations) {
    if (reservation.type === "flight") {
      const code = flightCode(reservation);
      if (!code) continue;
      const flightNumber = code.slice(2);
      const mentionsFlight = /flight|рейс|перел|as\s*\d/i.test(content);
      if (
        mentionsFlight &&
        (lower.includes(code.toLowerCase()) || new RegExp(`as\\s*${flightNumber}\\b`, "i").test(content))
      ) {
        return true;
      }
    }

    if (reservation.type === "car_rental" && /car rental|аренд|rental car/i.test(content)) {
      const titlePrefix = reservation.title.trim().toLowerCase().slice(0, 12);
      if (titlePrefix && lower.includes(titlePrefix)) return true;
    }

    if (reservation.type === "hotel" && /hotel|отель|hyatt|marriott|hilton/i.test(content)) {
      const titlePrefix = reservation.title.trim().toLowerCase().slice(0, 12);
      if (titlePrefix && lower.includes(titlePrefix)) return true;
    }
  }

  return false;
}

function prepareTripSummaryInput(input: FormatTripSummaryInput): FormatTripSummaryInput {
  const reservations = dedupeReservations(input.reservations);
  const memories = (input.memories ?? []).filter(
    (memory) => !memoryDuplicatesReservation(memory.content, reservations),
  );
  return { ...input, reservations, memories };
}

function reservationIcon(type: string): string {
  switch (type) {
    case "flight":
      return "✈️";
    case "hotel":
      return "🏨";
    case "car_rental":
      return "🚗";
    case "campsite":
      return "⛺";
    default:
      return "📌";
  }
}

function formatReservationDates(reservation: Reservation, locale: TripSummaryLocale): string | null {
  return formatDateRange(dateOnly(reservation.startAt), dateOnly(reservation.endAt), locale);
}

function formatFlightLine(reservation: Reservation, locale: TripSummaryLocale): string {
  const l = labels(locale);
  const parts: string[] = [];
  const date = dateOnly(reservation.startAt);
  if (date) parts.push(formatShortDate(date, locale));
  if (reservation.provider && !providerAlreadyInTitle(reservation.provider, reservation.title)) {
    parts.push(reservation.provider);
  }
  parts.push(reservation.title);
  const seat = metaString(reservation.metadata, "seat");
  if (seat) parts.push(`${l.seat} ${seat}`);
  if (reservation.confirmationNumber) parts.push(reservation.confirmationNumber);
  return parts.join("  · ");
}

function formatHotelLine(reservation: Reservation, locale: TripSummaryLocale): string {
  const parts: string[] = [reservation.title];
  const dates = formatReservationDates(reservation, locale);
  if (dates) parts.push(dates);
  if (reservation.address) parts.push(reservation.address);
  if (reservation.confirmationNumber) {
    parts.push(`${labels(locale).conf} ${reservation.confirmationNumber}`);
  }
  return parts.join(" · ");
}

function formatCarRentalLine(reservation: Reservation, locale: TripSummaryLocale): string {
  const parts: string[] = [reservation.title];
  const dates = formatReservationDates(reservation, locale);
  if (dates) parts.push(dates);
  if (reservation.confirmationNumber) {
    parts.push(`${labels(locale).conf} ${reservation.confirmationNumber}`);
  }
  return parts.join(" · ");
}

function formatGenericReservationLine(reservation: Reservation, locale: TripSummaryLocale): string {
  const parts: string[] = [reservation.title];
  const dates = formatReservationDates(reservation, locale);
  if (dates) parts.push(dates);
  if (reservation.confirmationNumber) {
    parts.push(`${labels(locale).conf} ${reservation.confirmationNumber}`);
  }
  return parts.join(" · ");
}

function formatReservationLine(reservation: Reservation, locale: TripSummaryLocale): string {
  switch (reservation.type) {
    case "flight":
      return formatFlightLine(reservation, locale);
    case "hotel":
      return formatHotelLine(reservation, locale);
    case "car_rental":
      return formatCarRentalLine(reservation, locale);
    default:
      return formatGenericReservationLine(reservation, locale);
  }
}

function resolveDayDate(day: ItineraryDayWithItems, trip: Trip): string | null {
  const explicit = fromDate(day.date);
  if (explicit) return explicit;
  if (!trip.startDate) return null;
  const base = new Date(trip.startDate);
  base.setUTCDate(base.getUTCDate() + day.dayNumber - 1);
  return fromDate(base);
}

function dayHeader(day: ItineraryDayWithItems, trip: Trip, locale: TripSummaryLocale): string {
  const l = labels(locale);
  const parts = [`📅 ${l.day} ${day.dayNumber}`];
  const date = resolveDayDate(day, trip);
  if (date) parts.push(formatShortDate(date, locale));
  if (day.title) parts.push(day.title);
  return parts.join(" · ");
}

function itineraryItemIcon(title: string): string {
  const lower = title.toLowerCase();
  if (/museum|музей|gallery|exhibit/.test(lower)) return "🎭";
  if (/restaurant|dinner|lunch|breakfast|cafe|кафе|обед|ужин/.test(lower)) return "🍽";
  if (/hike|trail|park|nature|парк|прогул/.test(lower)) return "🌲";
  return "📍";
}

interface DayEvent {
  sortKey: string;
  line: string;
}

function reservationDayEvents(
  reservation: Reservation,
  dayDate: string,
  locale: TripSummaryLocale,
): DayEvent[] {
  const l = labels(locale);
  const icon = reservationIcon(reservation.type);
  const start = dateOnly(reservation.startAt);
  const end = dateOnly(reservation.endAt);
  const events: DayEvent[] = [];

  if (reservation.type === "hotel") {
    if (start === dayDate) {
      events.push({
        sortKey: `a-${reservation.id}-in`,
        line: `   ${icon} ${reservation.title} · ${l.checkIn}`,
      });
    } else if (end === dayDate) {
      events.push({
        sortKey: `a-${reservation.id}-out`,
        line: `   ${icon} ${reservation.title} · ${l.checkOut}`,
      });
    } else if (start && end && dayDate > start && dayDate < end) {
      events.push({
        sortKey: `b-${reservation.id}-stay`,
        line: `   ${icon} ${reservation.title} · ${l.stay}`,
      });
    }
    return events;
  }

  if (reservation.type === "car_rental") {
    if (start === dayDate) {
      events.push({
        sortKey: `a-${reservation.id}-pickup`,
        line: `   ${icon} ${reservation.title} · ${l.pickup}`,
      });
    } else if (end === dayDate && end !== start) {
      events.push({
        sortKey: `a-${reservation.id}-return`,
        line: `   ${icon} ${reservation.title} · ${l.return}`,
      });
    }
    return events;
  }

  if (start === dayDate) {
    events.push({
      sortKey: `a-${reservation.id}`,
      line: `   ${icon} ${formatReservationLine(reservation, locale)}`,
    });
  }

  return events;
}

function formatCardSummary(input: FormatTripSummaryInput): string {
  const locale = input.locale ?? "en";
  const l = labels(locale);
  const { trip, itinerary, reservations, memories = [] } = input;
  const lines: string[] = [];

  const title = trip.title?.trim();
  if (title) lines.push(title);

  const dateRange = formatDateRange(fromDate(trip.startDate), fromDate(trip.endDate), locale);
  const headerParts: string[] = [];
  if (dateRange) headerParts.push(dateRange);
  if (trip.travelers?.trim()) headerParts.push(trip.travelers.trim());
  if (headerParts.length > 0) lines.push(`🗓 ${headerParts.join(" · ")}`);

  const location = trip.destination?.trim() || trip.summary?.trim();
  if (location && location !== title) lines.push(`📍 ${location}`);
  else if (trip.destination?.trim()) lines.push(`📍 ${trip.destination.trim()}`);

  const flights = reservations.filter((r) => r.type === "flight");
  const cars = reservations.filter((r) => r.type === "car_rental");
  const hotels = reservations.filter((r) => r.type === "hotel");
  const other = reservations.filter((r) => !["flight", "car_rental", "hotel"].includes(r.type));

  if (flights.length > 0 || cars.length > 0) {
    lines.push("");
    lines.push(`✈️ ${l.transport}`);
    for (const flight of flights) {
      lines.push(`   ${formatFlightLine(flight, locale)}`);
    }
    for (const car of cars) {
      lines.push(`   ${formatCarRentalLine(car, locale)}`);
    }
  }

  if (hotels.length > 0) {
    lines.push("");
    lines.push(`🏨 ${l.hotel}`);
    for (const hotel of hotels) {
      lines.push(`   ${formatHotelLine(hotel, locale)}`);
      if (hotel.notes?.trim()) lines.push(`   ${hotel.notes.trim()}`);
    }
  }

  if (other.length > 0) {
    lines.push("");
    for (const reservation of other) {
      lines.push(`${reservationIcon(reservation.type)} ${formatGenericReservationLine(reservation, locale)}`);
    }
  }

  const planDays = itinerary.filter((day) => day.title || day.items.some((item) => !item.isBackup));
  if (planDays.length > 0) {
    lines.push("");
    lines.push(`📋 ${l.plan}`);
    for (const day of planDays) {
      if (day.title) {
        lines.push(`   ${l.day} ${day.dayNumber} — ${day.title}`);
      }
      for (const item of day.items) {
        if (item.isBackup) continue;
        const date = resolveDayDate(day, trip);
        const dateHint = date ? `${formatShortDate(date, locale)} — ` : "";
        const timeHint = item.timeBlock ? `${item.timeBlock} · ` : "";
        lines.push(`   ${dateHint}${timeHint}${item.title}`);
      }
    }
  }

  const noteLines: string[] = [];
  if (trip.summary?.trim() && trip.summary.trim() !== trip.destination?.trim()) {
    noteLines.push(trip.summary.trim());
  }
  for (const memory of memories.slice(0, 5)) {
    if (memory.content.trim()) noteLines.push(memory.content.trim());
  }
  if (noteLines.length > 0) {
    lines.push("");
    lines.push(`📝 ${l.notes}`);
    for (const note of noteLines) {
      lines.push(`   ${note}`);
    }
  }

  return lines.join("\n").trim();
}

function collectReservationDates(reservations: Reservation[]): string[] {
  const dates = new Set<string>();
  for (const reservation of reservations) {
    const start = dateOnly(reservation.startAt);
    const end = dateOnly(reservation.endAt);
    if (start) dates.add(start);
    if (end) dates.add(end);
  }
  return [...dates].sort();
}

function formatDateOnlyHeader(date: string, locale: TripSummaryLocale): string {
  return `📅 ${formatShortDateWithYear(date, locale)}`;
}

function formatByDaySummary(input: FormatTripSummaryInput): string {
  const locale = input.locale ?? "en";
  const { trip, itinerary, reservations } = input;
  const lines: string[] = [];

  const title = trip.title?.trim();
  if (title) lines.push(title);

  const dateRange = formatDateRange(fromDate(trip.startDate), fromDate(trip.endDate), locale);
  if (dateRange) lines.push(`🗓 ${dateRange}`);
  if (trip.travelers?.trim()) lines.push(`👥 ${trip.travelers.trim()}`);

  if (itinerary.length === 0 && reservations.length === 0) {
    lines.push("");
    lines.push(locale === "ru" ? "Пока нет дней в плане." : "No itinerary days yet.");
    return lines.join("\n").trim();
  }

  const coveredDates = new Set<string>();

  for (const day of itinerary) {
    const dayDate = resolveDayDate(day, trip);
    const events: DayEvent[] = [];

    for (const item of day.items) {
      if (item.isBackup) continue;
      const icon = itineraryItemIcon(item.title);
      const timeHint = item.timeBlock ? `${item.timeBlock} · ` : "";
      events.push({
        sortKey: `c-${String(item.position).padStart(4, "0")}`,
        line: `   ${icon} ${timeHint}${item.title}`,
      });
    }

    if (dayDate) {
      coveredDates.add(dayDate);
      for (const reservation of reservations) {
        events.push(...reservationDayEvents(reservation, dayDate, locale));
      }
    }

    if (events.length === 0 && !day.title && !day.summary) continue;

    lines.push("");
    lines.push(dayHeader(day, trip, locale));
    if (day.summary?.trim()) lines.push(`   ${day.summary.trim()}`);
    for (const event of events.sort((a, b) => a.sortKey.localeCompare(b.sortKey))) {
      lines.push(event.line);
    }
  }

  for (const date of collectReservationDates(reservations)) {
    if (coveredDates.has(date)) continue;
    const events: DayEvent[] = [];
    for (const reservation of reservations) {
      events.push(...reservationDayEvents(reservation, date, locale));
    }
    if (events.length === 0) continue;
    lines.push("");
    lines.push(formatDateOnlyHeader(date, locale));
    for (const event of events.sort((a, b) => a.sortKey.localeCompare(b.sortKey))) {
      lines.push(event.line);
    }
  }

  return lines.join("\n").trim();
}

export function formatTripSummary(input: FormatTripSummaryInput): string {
  const prepared = prepareTripSummaryInput(input);
  if (prepared.format === "by_day") return formatByDaySummary(prepared);
  return formatCardSummary(prepared);
}
