export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  PASSWORD_NOT_SET: 'AUTH_PASSWORD_NOT_SET',
  ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  ROLE_WORKSPACE_MISMATCH: 'AUTH_ROLE_WORKSPACE_MISMATCH',
  RATE_LIMITED: 'AUTH_RATE_LIMITED',
  VALIDATION_FAILED: 'AUTH_VALIDATION_FAILED',
  SECRET_MISSING: 'AUTH_SECRET_MISSING',
  SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const authErrorPayload = (
  code: AuthErrorCode,
  message: string,
  extras?: Record<string, unknown>,
) => ({
  success: false as const,
  code,
  message,
  ...extras,
});
