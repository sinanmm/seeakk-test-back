import { z } from 'zod';

const trimString = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

/** Strip accidental newlines from copy-paste without altering intentional spaces. */
const stripPasswordWrapping = (value: unknown) => {
  if (typeof value !== 'string') return value;
  return value.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
};

export const forgotPasswordSchema = z.object({
  email: z.preprocess(
    trimString,
    z
      .string({ message: 'Email is required' })
      .min(1, 'Email is required')
      .email('Invalid email format')
      .transform((v) => v.toLowerCase()),
  ),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const validateResetTokenQuerySchema = z.object({
  token: z.preprocess(trimString, z.string().min(20, 'Reset token is required')),
});

export type ValidateResetTokenQueryInput = z.infer<typeof validateResetTokenQuerySchema>;

export const resetPasswordSchema = z.object({
  token: z.preprocess(trimString, z.string().min(20, 'Reset token is required')),
  newPassword: z.preprocess(
    stripPasswordWrapping,
    z
      .string({ message: 'Password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password too long'),
  ),
});

export type ResetPasswordWithTokenInput = z.infer<typeof resetPasswordSchema>;
