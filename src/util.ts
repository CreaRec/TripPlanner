/** Convert an optional ISO date string (YYYY-MM-DD) to a Date for Prisma @db.Date fields. */
export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date (or null) as YYYY-MM-DD. */
export function fromDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}
