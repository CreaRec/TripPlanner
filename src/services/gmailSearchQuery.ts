import type { Reservation, Trip } from "@prisma/client";
import type { Place } from "@prisma/client";
import { fromDate } from "../util";

function quoteTerm(term: string): string {
  const trimmed = term.trim();
  if (!trimmed) return "";
  if (/[\s"]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, "")}"`;
  }
  return trimmed;
}

function formatGmailDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const iso = fromDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-");
  return `${year}/${month}/${day}`;
}

function addOrTerms(terms: string[]): string {
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  return `(${unique.join(" OR ")})`;
}

export interface BuildGmailSearchQueryInput {
  userQuery?: string | null;
  trip?: Pick<Trip, "title" | "destination" | "startDate" | "endDate"> | null;
  reservation?: Pick<
    Reservation,
    "title" | "provider" | "confirmationNumber" | "startAt" | "endAt" | "address"
  > | null;
  place?: Pick<Place, "name" | "address"> | null;
}

export function buildGmailSearchQuery(input: BuildGmailSearchQueryInput): string {
  const parts: string[] = [];

  const after = formatGmailDate(input.trip?.startDate ?? input.reservation?.startAt ?? null);
  const before = formatGmailDate(input.trip?.endDate ?? input.reservation?.endAt ?? null);
  if (after) parts.push(`after:${after}`);
  if (before) parts.push(`before:${before}`);

  const orTerms: string[] = [];
  if (input.userQuery?.trim()) {
    orTerms.push(input.userQuery.trim());
  }
  if (input.trip?.destination?.trim()) {
    orTerms.push(quoteTerm(input.trip.destination));
  }
  if (input.trip?.title?.trim()) {
    orTerms.push(quoteTerm(input.trip.title));
  }
  if (input.reservation?.confirmationNumber?.trim()) {
    orTerms.push(quoteTerm(input.reservation.confirmationNumber));
  }
  if (input.reservation?.provider?.trim()) {
    orTerms.push(quoteTerm(input.reservation.provider));
  }
  if (input.reservation?.title?.trim()) {
    orTerms.push(quoteTerm(input.reservation.title));
  }
  if (input.place?.name?.trim()) {
    orTerms.push(quoteTerm(input.place.name));
  }
  if (input.place?.address?.trim()) {
    orTerms.push(quoteTerm(input.place.address));
  }

  const orClause = addOrTerms(orTerms);
  if (orClause) parts.push(orClause);

  return parts.join(" ").trim();
}
