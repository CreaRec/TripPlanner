export enum SavedPlaceStatus {
  WantToVisit = "want_to_visit",
  Visited = "visited",
  Archived = "archived",
}

export const SAVED_PLACE_STATUSES = Object.values(SavedPlaceStatus);

export function isSavedPlaceStatus(value: unknown): value is SavedPlaceStatus {
  return (SAVED_PLACE_STATUSES as string[]).includes(String(value));
}

export function parseSavedPlaceStatus(value: unknown): SavedPlaceStatus | null {
  return isSavedPlaceStatus(value) ? value : null;
}
