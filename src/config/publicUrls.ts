/**
 * Public URLs used in transactional emails and redirects.
 * Prefer env in all deployed environments; dev-only fallbacks when unset.
 */
const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

export const getPublicFrontendUrl = (): string => {
  const fromEnv = trimTrailingSlashes(process.env.FRONTEND_URL || '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== 'production') {
    return trimTrailingSlashes(process.env.VITE_DEV_FRONTEND_URL || 'http://localhost:5173');
  }
  return '';
};

export const getPublicBackendUrl = (): string => {
  const fromEnv = trimTrailingSlashes(process.env.BACKEND_URL || '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || '5000';
    return trimTrailingSlashes(process.env.VITE_DEV_BACKEND_URL || `http://localhost:${port}`);
  }
  return '';
};
