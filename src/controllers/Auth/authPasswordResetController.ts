import { Request, Response } from 'express';
import logger from '../../utils/logger';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  validateResetTokenQuerySchema,
} from '../../validations/passwordReset.validation';
import {
  passwordResetService,
  PasswordResetError,
  FORGOT_PASSWORD_GENERIC_MESSAGE,
} from '../../services/Auth/passwordResetService';

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

const handlePasswordResetError = (res: Response, error: unknown, fallbackMessage: string) => {
  if (error instanceof PasswordResetError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }
  logger.error(fallbackMessage, { error: (error as any)?.message });
  return res.status(500).json({ message: fallbackMessage });
};

export const forgotPassword = async (req: Request, res: Response): Promise<any> => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ message: 'A valid email address is required.' });
  }

  try {
    const result = await passwordResetService.requestReset(parsed.data.email, requestContext(req));
    return res.status(200).json(result);
  } catch (error: any) {
    // Never leak whether the email exists, even on unexpected failures.
    logger.error('Forgot password request failed', { error: error?.message });
    return res.status(200).json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  }
};

export const validateResetToken = async (req: Request, res: Response): Promise<any> => {
  const parsed = validateResetTokenQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'A valid reset token is required.' });
  }

  try {
    const result = await passwordResetService.validateToken(parsed.data.token);
    return res.status(200).json(result);
  } catch (error) {
    return handlePasswordResetError(res, error, 'Failed to validate reset token.');
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<any> => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || 'Invalid request.';
    return res.status(422).json({ message: firstError });
  }

  try {
    const result = await passwordResetService.resetPassword(
      parsed.data.token,
      parsed.data.newPassword,
      requestContext(req),
    );
    return res.status(200).json(result);
  } catch (error) {
    return handlePasswordResetError(res, error, 'Failed to reset password.');
  }
};
