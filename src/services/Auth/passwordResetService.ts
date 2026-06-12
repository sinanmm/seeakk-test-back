import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import auditService from '../Audit/auditService';
import { createInviteTokenPair, hashInviteToken } from '../../utils/inviteToken';
import { sendForgotPasswordEmail } from '../Email/emailService';

const RESET_TOKEN_TTL_MINUTES = 30;
const BCRYPT_ROUNDS = 12;

/** Always returned by requestReset to prevent user enumeration. */
export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

const INVALID_TOKEN_MESSAGE =
  'This password reset link is invalid or has expired. Please request a new one.';

export class PasswordResetError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

type Deps = {
  prisma: any;
  tokenFactory: () => { rawToken: string; tokenHash: string };
  hashToken: (token: string) => string;
  hashPassword: (password: string, rounds: number) => Promise<string>;
  sendResetEmail: (
    email: string,
    name: string | null | undefined,
    token: string,
    expiresInMinutes: number,
  ) => Promise<boolean>;
  invalidateSessions: (userId: string) => Promise<void>;
  audit: { log: (payload: any) => Promise<any> };
  now?: () => Date;
};

/** Same Redis refresh-session sweep used by authController and adminUserService. */
const invalidateUserSessions = async (userId: string): Promise<void> => {
  try {
    if (!redisClient.isOpen) return;
    let cursor = 0;
    do {
      const reply = await (redisClient as any).scan(cursor, { MATCH: 'refresh:*', COUNT: 100 });
      cursor = Number(reply.cursor);
      for (const key of reply.keys) {
        const storedUserId = await redisClient.get(key);
        if (storedUserId === userId) {
          await redisClient.del(key);
        }
      }
    } while (cursor !== 0);
  } catch (error: any) {
    logger.warn('Failed to invalidate user sessions during password reset', { userId, error: error?.message });
  }
};

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
};

export const createPasswordResetService = (deps: Deps) => {
  const now = deps.now || (() => new Date());

  const findValidTokenRecord = async (rawToken: string) => {
    const tokenHash = deps.hashToken(rawToken);
    const record = await deps.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, name: true, email: true, workspaceId: true, deletedAt: true, isActive: true } } },
    });

    if (!record || !record.user || record.user.deletedAt || !record.user.isActive) {
      throw new PasswordResetError(INVALID_TOKEN_MESSAGE, 400, 'RESET_TOKEN_INVALID');
    }
    if (record.usedAt) {
      throw new PasswordResetError(INVALID_TOKEN_MESSAGE, 410, 'RESET_TOKEN_USED');
    }
    if (record.expiresAt <= now()) {
      throw new PasswordResetError(INVALID_TOKEN_MESSAGE, 410, 'RESET_TOKEN_EXPIRED');
    }

    return record;
  };

  return {
    /**
     * Self-service forgot password. Always resolves with the same generic
     * message whether or not the email belongs to an account (no enumeration).
     */
    async requestReset(email: string, context?: RequestContext) {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await deps.prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null, isActive: true },
        select: { id: true, name: true, email: true, workspaceId: true },
      });

      if (!user) {
        logger.info('Password reset requested for unknown or inactive email', {
          email: maskEmail(normalizedEmail),
          ip: context?.ipAddress,
        });
        return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
      }

      // Single active token policy + opportunistic cleanup of expired rows.
      await deps.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            { userId: user.id, usedAt: null },
            { expiresAt: { lt: now() } },
          ],
        },
      });

      const { rawToken, tokenHash } = deps.tokenFactory();
      const expiresAt = new Date(now().getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      await deps.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          requestedIp: context?.ipAddress || null,
        },
      });

      const delivered = await deps.sendResetEmail(user.email, user.name, rawToken, RESET_TOKEN_TTL_MINUTES);
      if (!delivered) {
        logger.warn('Password reset email could not be delivered', { userId: user.id });
      }

      await deps.audit.log({
        userId: user.id,
        workspaceId: user.workspaceId || undefined,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        details: { delivered, expiresAt: expiresAt.toISOString() },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
    },

    /** Pre-flight check used by the reset page before showing the form. */
    async validateToken(rawToken: string) {
      const record = await findValidTokenRecord(rawToken);
      return {
        valid: true as const,
        email: maskEmail(record.user.email),
        expiresAt: record.expiresAt.toISOString(),
      };
    },

    async resetPassword(rawToken: string, newPassword: string, context?: RequestContext) {
      const record = await findValidTokenRecord(rawToken);
      const passwordHash = await deps.hashPassword(newPassword, BCRYPT_ROUNDS);
      const usedAt = now();

      await deps.prisma.$transaction([
        deps.prisma.user.update({
          where: { id: record.userId },
          data: { password: passwordHash },
        }),
        deps.prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt },
        }),
        deps.prisma.passwordResetToken.deleteMany({
          where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        }),
      ]);

      await deps.invalidateSessions(record.userId);

      await deps.audit.log({
        userId: record.userId,
        workspaceId: record.user.workspaceId || undefined,
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: record.userId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      logger.info('Self-service password reset completed', { userId: record.userId });

      return { message: 'Password updated successfully. Please log in with your new password.' };
    },
  };
};

export const passwordResetService = createPasswordResetService({
  prisma,
  tokenFactory: createInviteTokenPair,
  hashToken: hashInviteToken,
  hashPassword: bcrypt.hash,
  sendResetEmail: sendForgotPasswordEmail,
  invalidateSessions: invalidateUserSessions,
  audit: auditService,
});
