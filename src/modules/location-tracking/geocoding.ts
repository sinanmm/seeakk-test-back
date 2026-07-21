import axios from 'axios';

const geocodeCache = new Map<string, string>();

export const reverseGeocode = async (latitude: number, longitude: number): Promise<string | null> => {
  const lat = latitude.toFixed(4);
  const lon = longitude.toFixed(4);
  const cacheKey = `${lat},${lon}`;

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) || null;
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'jsonv2' },
      headers: { 'User-Agent': 'SeeakkCRM/1.0 (LocationTracker)' },
      timeout: 5000,
    });

    if (response.data && response.data.display_name) {
      const parts = response.data.display_name.split(',').map((p: string) => p.trim());
      const shortAddress = parts.slice(0, 4).join(', ');
      geocodeCache.set(cacheKey, shortAddress);
      return shortAddress;
    }
  } catch (error) {
    console.error(`Reverse geocoding failed for ${lat},${lon}:`, (error as Error).message);
  }

  return null;
};
