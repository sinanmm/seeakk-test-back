const normalizeOrigin = (origin: string): string =>
  origin.trim().toLowerCase().replace(/\/+$/, '');

/** Split on comma, semicolon, or whitespace (common in Render / .env pastes). */
const splitOrigins = (value?: string | null): string[] =>
  (value || '')
    .split(/[\s,;]+/)
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

export const getAllowedOrigins = (): string[] =>
  Array.from(
    new Set([
      ...splitOrigins(process.env.FRONTEND_URL),
      ...splitOrigins(process.env.ALLOWED_ORIGINS),
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
    ]),
  );

export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();

  // Exact match or matches a www/non-www variant
  const isMatch = allowed.some(a => {
    if (a === normalized) return true;
    if (a.replace(/^https?:\/\/(www\.)?/, '') === normalized.replace(/^https?:\/\/(www\.)?/, '')) return true;
    return false;
  });

  return isMatch;
};

export const corsOriginHandler = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => {
  if (!origin || isAllowedOrigin(origin)) {
    callback(null, true);
  } else {
    console.warn(`[CORS] Blocked origin: "${origin}"`);
    callback(new Error(`Not allowed by CORS: ${origin}`));
  }
};
