import type { ZodError } from 'zod';

export const formatZodValidationErrors = (
  error: ZodError,
): { message: string; errors: Record<string, string[]> } => {
  const flattened = error.flatten();
  const fieldMessages = Object.values(flattened.fieldErrors)
    .flat()
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const formMessages = flattened.formErrors.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  const message = fieldMessages[0] || formMessages[0] || 'Validation failed.';

  return {
    message,
    errors: flattened.fieldErrors as Record<string, string[]>,
  };
};
