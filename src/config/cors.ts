const normalizeOrigin = (origin: string): string =>
  origin.trim().replace(/\/+$/, '');

const splitOrigins = (value?: string | null): string[] =>
  (value || '')
    .split(/[\s,]+/)
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

export const getAllowedOrigins = (): string[] =>
  Array.from(
    new Set([
      'https://lms-frontend-amber-beta.vercel.app',
      ...splitOrigins(process.env.FRONTEND_URL),
      ...splitOrigins(process.env.ALLOWED_ORIGINS),
      'http://localhost:5173',
      'http://localhost:3000',
    ]),
  );

export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;
  return getAllowedOrigins().includes(normalizeOrigin(origin));
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
