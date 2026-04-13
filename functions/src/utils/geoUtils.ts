import { Location } from '../types';

/**
 * Haversine formula — distance between two lat/lng points in kilometres.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Returns a normalised distance score (0–1).
 * Same city → 1.0 | < 50 km → 0.7 | ≥ 50 km → 0.3
 */
export function distanceScore(doctorLocation: Location, patientLocation: Location): number {
  if (
    doctorLocation.city.toLowerCase().trim() ===
    patientLocation.city.toLowerCase().trim()
  ) {
    return 1.0;
  }

  const km = calculateDistance(
    doctorLocation.lat,
    doctorLocation.lng,
    patientLocation.lat,
    patientLocation.lng
  );

  if (km < 50) return 0.7;
  return 0.3;
}
