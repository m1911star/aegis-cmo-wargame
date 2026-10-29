import * as turf from '@turf/turf';

export function calculateRadarHorizonKm(
  observerAltitudeM: number,
  observerAntennaHeightM: number,
  targetAltitudeM: number
): number {
  const effectiveObserverHeightM = Math.max(
    2,
    Math.max(0, observerAltitudeM) + Math.max(0, observerAntennaHeightM)
  );
  if (targetAltitudeM < -5) {
    return 0;
  }
  const effectiveTargetHeightM =
    targetAltitudeM <= 0 ? 14 : Math.max(2, targetAltitudeM);

  return (
    4.12 *
    (Math.sqrt(effectiveObserverHeightM) + Math.sqrt(effectiveTargetHeightM))
  );
}

export function getDistanceKm(
  posA: [number, number],
  posB: [number, number]
): number {
  return turf.distance(posA, posB, { units: 'kilometers' });
}

export function getBearingDeg(
  from: [number, number],
  to: [number, number]
): number {
  const b = turf.bearing(from, to);
  return (b + 360) % 360;
}
