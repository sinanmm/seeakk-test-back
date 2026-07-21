import prisma from '../../config/prisma';
import { distanceMeters } from './locationTracking.service';
import { reverseGeocode } from './geocoding';

const STOP_RADIUS_METERS = 30;
const STOP_MIN_SECONDS = 5 * 60; // 5 minutes

export const recalculateStops = async (sessionId: string, workspaceId: string, userId: string) => {
  const points = await (prisma as any).locationPoint.findMany({
    where: { sessionId },
    orderBy: { recordedAt: 'asc' },
  });

  if (points.length === 0) return;

  const stops: any[] = [];
  let currentStop: any = null;

  for (const point of points) {
    const pointTime = new Date(point.recordedAt).getTime();

    if (!currentStop) {
      // Start a potential stop
      currentStop = {
        latitude: point.latitude,
        longitude: point.longitude,
        startedAt: point.recordedAt,
        endedAt: point.recordedAt,
        points: [point],
      };
    } else {
      const dist = distanceMeters(currentStop, point);
      if (dist <= STOP_RADIUS_METERS) {
        // Still at the same place
        currentStop.endedAt = point.recordedAt;
        currentStop.points.push(point);
      } else {
        // Moved away
        const duration = Math.round((new Date(currentStop.endedAt).getTime() - new Date(currentStop.startedAt).getTime()) / 1000);
        if (duration >= STOP_MIN_SECONDS) {
          stops.push({ ...currentStop, durationSeconds: duration });
        }
        // Start new potential stop
        currentStop = {
          latitude: point.latitude,
          longitude: point.longitude,
          startedAt: point.recordedAt,
          endedAt: point.recordedAt,
          points: [point],
        };
      }
    }
  }

  // Check the last open stop
  if (currentStop) {
    const duration = Math.round((new Date(currentStop.endedAt).getTime() - new Date(currentStop.startedAt).getTime()) / 1000);
    if (duration >= STOP_MIN_SECONDS) {
      stops.push({ ...currentStop, durationSeconds: duration });
    }
  }

  // Reverse geocode stops
  for (const stop of stops) {
    stop.address = await reverseGeocode(stop.latitude, stop.longitude);
  }

  // Now overwrite the stops for this session
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.locationStop.deleteMany({ where: { sessionId } });
    
    if (stops.length > 0) {
      await tx.locationStop.createMany({
        data: stops.map(s => ({
          workspaceId,
          userId,
          sessionId,
          latitude: s.latitude,
          longitude: s.longitude,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationSeconds: s.durationSeconds,
          address: s.address,
        })),
      });
    }
  });
};
