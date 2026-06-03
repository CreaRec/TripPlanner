export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE_LATITUDE = 111_320;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function decodeEncodedPolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return points;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toLocalMeters(point: LatLng, referenceLatitude: number) {
  const longitudeScale = METERS_PER_DEGREE_LATITUDE * Math.cos(toRadians(referenceLatitude));
  return {
    x: point.longitude * longitudeScale,
    y: point.latitude * METERS_PER_DEGREE_LATITUDE,
  };
}

function distanceToSegmentMeters(point: LatLng, start: LatLng, end: LatLng): number {
  const referenceLatitude = (point.latitude + start.latitude + end.latitude) / 3;
  const p = toLocalMeters(point, referenceLatitude);
  const a = toLocalMeters(start, referenceLatitude);
  const b = toLocalMeters(end, referenceLatitude);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segmentLengthSquared = dx * dx + dy * dy;

  if (segmentLengthSquared === 0) {
    return distanceMeters(point, start);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segmentLengthSquared));
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - projection.x, p.y - projection.y);
}

export function distanceToPolylineMeters(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return distanceMeters(point, polyline[0]);

  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    best = Math.min(best, distanceToSegmentMeters(point, polyline[i - 1], polyline[i]));
  }
  return best;
}
