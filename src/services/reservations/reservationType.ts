export enum ReservationType {
  Hotel = "hotel",
  CarRental = "car_rental",
  Flight = "flight",
  Campsite = "campsite",
  Other = "other",
}

export const RESERVATION_TYPES = Object.values(ReservationType);

export const ENRICHABLE_RESERVATION_TYPES = [
  ReservationType.Flight,
  ReservationType.Hotel,
  ReservationType.CarRental,
  ReservationType.Campsite,
  ReservationType.Other,
] as const;

export function isReservationType(value: unknown): value is ReservationType {
  return (RESERVATION_TYPES as string[]).includes(String(value));
}

export function parseReservationType(value: unknown): ReservationType | null {
  return isReservationType(value) ? value : null;
}

export function isEnrichableReservationType(type: string): boolean {
  return (ENRICHABLE_RESERVATION_TYPES as readonly string[]).includes(type);
}
