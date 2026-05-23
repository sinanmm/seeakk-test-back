import { z } from 'zod';

const trimString = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

/** Strip accidental newlines from copy-paste without altering intentional spaces. */
const stripPasswordWrapping = (value: unknown) => {
  if (typeof value !== 'string') return value;
  return value.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
};

export const loginSchema = z.object({
  email: z.preprocess(
    trimString,
    z
      .string({ message: 'Email is required' })
      .min(1, 'Email is required')
      .email('Invalid email format')
      .transform((v) => v.toLowerCase()),
  ),
  password: z.preprocess(
    stripPasswordWrapping,
    z.string({ message: 'Password is required' }).min(1, 'Password is required'),
  ),
});

export type LoginInput = z.infer<typeof loginSchema>;
