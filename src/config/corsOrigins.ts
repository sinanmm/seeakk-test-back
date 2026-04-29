const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');

const splitOriginList = (raw?: string | null): string[] =>
  (raw || '')
    .split(/[\s,]+/)
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

export const allowedOrigins = Array.from(
  new Set([
    ...splitOriginList(process.env.FRONTEND_URL),
    ...splitOriginList(process.env.ALLOWED_ORIGINS),
    'http://localhost:5173',
  ]),
);

export const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
};
