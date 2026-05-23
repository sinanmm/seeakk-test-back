export type OfficeLocationRecord = {
  id: string;
  officeName: string;
  branch?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isEnabled?: boolean;
};

export type LocationCheckPayload = {
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracy?: number | null;
  locationCapturedAt?: string | null;
};

export type OfficeLocationValidationResult =
  | {
      ok: true;
      officeLocationId: string;
      distanceMeters: number;
      allowedRadiusMeters: number;
      officeName: string;
      branch?: string | null;
    }
  | {
      ok: false;
      errorCode: string;
      message: string;
      details: Record<string, string | number | boolean>;
    };

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_GPS_ACCURACY_METERS = Number.parseInt(
  process.env.ATTENDANCE_MAX_GPS_ACCURACY_METERS || '200',
  10,
) || 200;
const MAX_LOCATION_AGE_MS = 5 * 60 * 1000;

/** Haversine distance in meters between two WGS84 coordinates. */
export const haversineDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

export const OFFICE_LOCATION_NOT_CONFIGURED_MESSAGE =
  'Office location is not configured yet. Please contact administrator.';

export const OFFICE_BRANCH_NOT_ASSIGNED_MESSAGE =
  'No office branch is assigned to your account. Please contact your administrator.';

export type AttendanceApplyType = 'FROM_OFFICE' | 'FROM_ANYWHERE';

/** Treat null/empty/unknown values as From Anywhere (safe default). */
export const normalizeAttendanceApplyType = (
  attendanceApplyType: string | null | undefined,
): AttendanceApplyType =>
  attendanceApplyType === 'FROM_OFFICE' ? 'FROM_OFFICE' : 'FROM_ANYWHERE';

export const requiresOfficeLocationValidation = (
  attendanceApplyType: string | null | undefined,
  attendanceType: string,
): boolean => {
  if (normalizeAttendanceApplyType(attendanceApplyType) !== 'FROM_OFFICE') return false;
  if (attendanceType === 'HOLIDAY' || attendanceType === 'WEEKLY_OFF') return false;
  if (['WORK_FROM_HOME', 'LEAVE'].includes(attendanceType)) return false;
  return true;
};

const isValidCoordinate = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= -90 &&
  lat <= 90 &&
  lon >= -180 &&
  lon <= 180;

const isSuspiciousGps = (accuracy?: number | null): boolean => {
  if (accuracy == null || !Number.isFinite(accuracy)) return false;
  return accuracy > MAX_GPS_ACCURACY_METERS;
};

const isStaleCapture = (capturedAt?: string | null): boolean => {
  if (!capturedAt) return false;
  const ts = new Date(capturedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > MAX_LOCATION_AGE_MS;
};

export const toOfficeLocationProfile = (location: OfficeLocationRecord) => ({
  id: location.id,
  officeName: location.officeName,
  branch: location.branch || '',
  latitude: location.latitude,
  longitude: location.longitude,
  radiusMeters: location.radiusMeters,
});

export const validateOfficeLocation = (
  office: OfficeLocationRecord | null | undefined,
  payload: LocationCheckPayload,
): OfficeLocationValidationResult => {
  if (!office || office.isEnabled === false) {
    return {
      ok: false,
      errorCode: 'OFFICE_LOCATION_NOT_CONFIGURED',
      message: OFFICE_LOCATION_NOT_CONFIGURED_MESSAGE,
      details: { configuredLocation: false },
    };
  }

  const lat = payload.latitude;
  const lon = payload.longitude;

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      errorCode: 'GPS_LOCATION_REQUIRED',
      message: 'Location access is required for attendance.',
      details: { hasLatitude: lat != null, hasLongitude: lon != null },
    };
  }

  if (!isValidCoordinate(lat, lon)) {
    return {
      ok: false,
      errorCode: 'GPS_INVALID_COORDINATES',
      message: 'Invalid GPS coordinates received.',
      details: { latitude: lat, longitude: lon },
    };
  }

  if (isSuspiciousGps(payload.gpsAccuracy)) {
    return {
      ok: false,
      errorCode: 'GPS_ACCURACY_TOO_LOW',
      message: 'GPS signal is too weak. Please enable location services and try again outdoors.',
      details: {
        gpsAccuracy: payload.gpsAccuracy ?? -1,
        maxAllowedAccuracy: MAX_GPS_ACCURACY_METERS,
      },
    };
  }

  if (isStaleCapture(payload.locationCapturedAt)) {
    return {
      ok: false,
      errorCode: 'GPS_STALE_LOCATION',
      message: 'Location data is outdated. Please capture your live location again.',
      details: { stale: true },
    };
  }

  const distanceMeters = haversineDistanceMeters(lat, lon, office.latitude, office.longitude);
  const allowedRadius = Math.max(10, office.radiusMeters || 50);

  if (distanceMeters > allowedRadius) {
    return {
      ok: false,
      errorCode: 'OFFICE_LOCATION_OUT_OF_RADIUS',
      message: 'You can only mark attendance from office location.',
      details: {
        distanceMeters: Math.round(distanceMeters * 10) / 10,
        allowedRadiusMeters: allowedRadius,
        officeName: office.officeName,
        branch: office.branch || '',
        officeLatitude: office.latitude,
        officeLongitude: office.longitude,
      },
    };
  }

  return {
    ok: true,
    officeLocationId: office.id,
    distanceMeters,
    allowedRadiusMeters: allowedRadius,
    officeName: office.officeName,
    branch: office.branch,
  };
};
