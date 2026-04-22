import { z } from 'zod';
import { createUserSchema } from '../../validations/adminUserValidation';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const createInviteSchema = createUserSchema.omit({ password: true });

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const validateInviteQuerySchema = z.object({
  token: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(20, 'Invite token is required'),
  ),
});

export type ValidateInviteQueryInput = z.infer<typeof validateInviteQuerySchema>;

export const acceptInviteSchema = z.object({
  token: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(20, 'Invite token is required'),
  ),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
