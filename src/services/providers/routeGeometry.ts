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

function encodeSignedValue(value: number): string {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (encoded >= 0x20) {
    output += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  output += String.fromCharCode(encoded + 63);
  return output;
}

export function encodePolyline(points: LatLng[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";

  for (const point of points) {
    const latitude = Math.round(point.latitude * 1e5);
    const longitude = Math.round(point.longitude * 1e5);
    encoded += encodeSignedValue(latitude - previousLatitude);
    encoded += encodeSignedValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }

  return encoded;
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

function simplifySection(points: LatLng[], startIndex: number, endIndex: number, toleranceMeters: number, keep: boolean[]): void {
  if (endIndex <= startIndex + 1) return;

  let maxDistance = -1;
  let maxIndex = startIndex;
  for (let i = startIndex + 1; i < endIndex; i += 1) {
    const distance = distanceToSegmentMeters(points[i], points[startIndex], points[endIndex]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > toleranceMeters) {
    keep[maxIndex] = true;
    simplifySection(points, startIndex, maxIndex, toleranceMeters, keep);
    simplifySection(points, maxIndex, endIndex, toleranceMeters, keep);
  }
}

export function simplifyPolyline(points: LatLng[], toleranceMeters: number): LatLng[] {
  if (points.length <= 2) return points;
  const keep = points.map(() => false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifySection(points, 0, points.length - 1, toleranceMeters, keep);
  return points.filter((_, index) => keep[index]);
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
