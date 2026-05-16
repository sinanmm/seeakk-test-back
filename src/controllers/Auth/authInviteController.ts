import type { NextFunction, Request, Response } from 'express';
import { acceptInviteSchema, type AcceptInviteInput, type ValidateInviteQueryInput, validateInviteQuerySchema } from '../../modules/invites/invite.validation';
import { inviteService } from '../../modules/invites/invite.service';
import generateTokens from '../../utils/RefreshToken';
import { hydrateAuthenticatedUser } from '../../utils/userHydration';
import { serializeAuthenticatedUser } from '../../utils/authSerializers';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import { redisClient } from '../../config/redis';

const validate = <T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null => {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  return result.data as T;
};

const handleInviteError = (error: any, res: Response, next: NextFunction) => {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  return next(error);
};

export const validateInvite = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<ValidateInviteQueryInput>(validateInviteQuerySchema, req.query, res);
  if (!input) return;

  try {
    const result = await inviteService.validateInvite(input);
    return res.status(200).json({
      success: true,
      message: 'Invite token is valid.',
      data: result,
    });
  } catch (error) {
    return handleInviteError(error, res, next);
  }
};

export const acceptInvite = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<AcceptInviteInput>(acceptInviteSchema, req.body, res);
  if (!input) return;

  try {
    const result = await inviteService.acceptInvite(input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Auto-login: Hydrate, generate tokens, and return full auth payload
    const hydratedUser = await hydrateAuthenticatedUser(result.user);
    const tokens = generateTokens(hydratedUser);
    
    if (redisClient?.isReady) {
      await redisClient.set(`refresh:${tokens.tokenId}`, hydratedUser.id);
    }

    const resolvedWorkspaceId = await resolveWorkspaceIdForUser(hydratedUser.id, hydratedUser.workspaceId);

    return res.status(200).json({
      success: true,
      message: result.message,
      data: {
        user: serializeAuthenticatedUser(hydratedUser, resolvedWorkspaceId),
        ...tokens,
      }
    });
  } catch (error) {
    return handleInviteError(error, res, next);
  }
};
