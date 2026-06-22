import { PLACE_CATEGORIES } from "../../services/places/places";
import type { PlaceCategory } from "../../services/places/places";
import { SAVED_PLACE_STATUSES, SavedPlaceStatus } from "../../services/places/savedPlaces";
import { RESERVATION_TYPES } from "../../services/reservations/reservations";
import { EXPORT_FORMATS } from "../../services/export/exportFormat";
import type { AgentContext } from "./context";

export const PLACE_CATEGORY_VALUES = PLACE_CATEGORIES;
export const SAVED_PLACE_STATUS_VALUES = SAVED_PLACE_STATUSES;
export const RESERVATION_TYPE_VALUES = RESERVATION_TYPES;
export const EXPORT_FORMAT_VALUES = EXPORT_FORMATS;

export function requireTrip(ctx: AgentContext): number {
  if (ctx.activeTripId === null) {
    throw new Error(
      "No active trip. Create one with create_trip first (it becomes the active trip).",
    );
  }
  return ctx.activeTripId;
}

export function requireConfirmation(args: Record<string, unknown>): void {
  if (args.confirmed !== true) {
    throw new Error("Explicit user confirmation is required before deleting data.");
  }
}

export function requireInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`${name} must be an integer.`);
  }
  return number;
}

export function requirePlaceCategory(value: unknown, name: string): PlaceCategory {
  if (value === null) return "other";
  if (
    typeof value !== "string" ||
    !PLACE_CATEGORY_VALUES.includes(value as (typeof PLACE_CATEGORY_VALUES)[number])
  ) {
    throw new Error(`${name} must be one of: ${PLACE_CATEGORY_VALUES.join(", ")}.`);
  }
  return value as PlaceCategory;
}

export function requireSavedPlaceStatus(value: unknown, name: string): SavedPlaceStatus {
  if (value === null) return SavedPlaceStatus.WantToVisit;
  if (
    typeof value !== "string" ||
    !SAVED_PLACE_STATUS_VALUES.includes(value as (typeof SAVED_PLACE_STATUS_VALUES)[number])
  ) {
    throw new Error(`${name} must be one of: ${SAVED_PLACE_STATUS_VALUES.join(", ")}.`);
  }
  return value as SavedPlaceStatus;
}
