const normalizeOrigin = (origin: string): string => {
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const isDefaultPort =
      parsed.port === '' ||
      (protocol === 'https:' && parsed.port === '443') ||
      (protocol === 'http:' && parsed.port === '80');
    return `${protocol}//${hostname}${isDefaultPort ? '' : `:${parsed.port}`}`;
  } catch {
    return trimmed.toLowerCase();
  }
};

const splitOrigins = (value?: string): string[] =>
  (value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const getAllowedOrigins = (): string[] =>
  Array.from(
    new Set(
      [
        ...splitOrigins(process.env.FRONTEND_URL),
        ...splitOrigins(process.env.ALLOWED_ORIGINS),
        'https://lms-frontend-amber-beta.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000',
      ].map((origin) => normalizeOrigin(origin)),
    ),
  );

export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return getAllowedOrigins().includes(normalized);
};

export const corsOriginHandler = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
  } else {
    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error(`Not allowed by CORS: ${origin}`));
  }
};
