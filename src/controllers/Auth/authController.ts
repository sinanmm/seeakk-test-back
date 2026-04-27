import { Request, Response } from 'express';
import verifyGoogleToken from '../../services/Auth/googleAuthService';
import generateTokens from '../../utils/RefreshToken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import { sendVerificationEmail } from '../../services/Email/emailService';
import { trackUserDevice } from '../../utils/deviceTracker';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
 
const authenticatedUserBaseSelect = {
  id: true,
  name: true,
  email: true,
  password: true,
  roleId: true,
  workspaceId: true,
  isOnboarded: true,
  isActive: true,
  isEmailVerified: true,
} as const;

const isPrismaSchemaMismatchError = (error: any): boolean => error?.code === 'P2021' || error?.code === 'P2022';

const isTransientDatabaseError = (error: any): boolean => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'P1001' ||
    code === 'P1017' ||
    code === 'P2024' ||
    message.includes('error in postgresql connection') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('can not perform operation: connection is closed') ||
    message.includes('connection is closed')
  );
};

const hydrateAuthenticatedUser = async (user: any): Promise<any> => {
  if (!user?.id) return user;

  const hydrated = { ...user } as any;

  // Role is optional in older/partial schemas; hydrate best-effort.
  if (hydrated.roleId) {
    try {
      const role = await prisma.role.findUnique({
        where: { id: hydrated.roleId },
        select: {
          id: true,
          name: true,
          status: true,
          isSystemRole: true,
          workspaceId: true,
        },
      });
      hydrated.role = role || null;
    } catch {
      try {
        const roleMinimal = await prisma.role.findUnique({
          where: { id: hydrated.roleId },
          select: { id: true, name: true, workspaceId: true },
        });
        hydrated.role = roleMinimal
          ? { ...roleMinimal, status: undefined, isSystemRole: undefined }
          : null;
      } catch {
        hydrated.role = null;
      }
    }
  } else {
    hydrated.role = null;
  }

  if (hydrated.role?.id) {
    try {
      const rolePermissions = await prisma.rolePermission.findMany({
        where: { roleId: hydrated.role.id },
        include: {
          permission: { select: { key: true } },
        },
      });
      hydrated.role.permissions = rolePermissions;
    } catch {
      hydrated.role.permissions = [];
    }
  }

  try {
    hydrated.devices = await prisma.device.findMany({
      where: { userId: hydrated.id },
      orderBy: { lastActive: 'desc' },
    });
  } catch {
    hydrated.devices = [];
  }

  if (hydrated.workspaceId) {
    try {
      hydrated.workspace = await prisma.workspace.findUnique({
        where: { id: hydrated.workspaceId },
        select: { id: true, companyName: true },
      });
    } catch {
      try {
        hydrated.workspace = await prisma.workspace.findUnique({
          where: { id: hydrated.workspaceId },
          select: { id: true },
        });
      } catch {
        hydrated.workspace = null;
      }
    }
  } else {
    hydrated.workspace = null;
  }

  return hydrated;
};

const serializeAuthenticatedUser = (user: any, resolvedWorkspaceId?: string | null) => {
  const rawPermissionKeys = Array.isArray(user.role?.permissions)
    ? user.role.permissions
        .map((rolePermission: any) => rolePermission?.permission?.key)
        .filter((key: unknown): key is string => typeof key === 'string' && key.length > 0)
    : [];
  const permissionKeys = normalizeRoleKey(user.role?.name || '') === SUPERADMIN_ROLE_NAME
    ? Array.from(new Set([...rawPermissionKeys, 'SUPERADMIN']))
    : rawPermissionKeys;

  const workspaceId =
    (typeof resolvedWorkspaceId === 'string' && resolvedWorkspaceId.trim()) ||
    (typeof user.workspaceId === 'string' && user.workspaceId.trim()) ||
    (typeof user.workspace?.id === 'string' && user.workspace.id.trim()) ||
    null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          status: user.role.status,
          isSystemRole: user.role.isSystemRole,
        }
      : null,
    permissions: permissionKeys,
    isOnboarded: user.isOnboarded,
    devices: user.devices,
    workspaceId,
    workspace: user.workspace,
  };
};

const resolveWorkspaceForAuthPayload = async (user: {
  id: string;
  workspaceId?: string | null;
}): Promise<string | null> => {
  try {
    return await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
  } catch (error: any) {
    logger.warn('Failed to resolve workspace id for auth payload', {
      userId: user.id,
      error: error?.message,
      action: 'auth_resolve_workspace_failed',
    });
    return null;
  }
};

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const normalizeRoleKey = (role: string): string =>
  role
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const SUPERADMIN_ROLE_NAME = 'superadmin';

const isRoleScopedToUserWorkspace = (user: any): boolean => {
  if (!user?.roleId || !user?.workspaceId || !user?.role?.workspaceId) {
    return true;
  }

  return user.role.workspaceId === user.workspaceId;
};

const extractGoogleCredentialToken = (body: any): string => {
  const candidates = [
    body?.credential,
    body?.token,
    body?.credentialResponse?.credential,
    body?.idToken,
    body?.response?.credential,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const token = candidate.trim();
      if (token) return token;
    }
  }

  return '';
};

const ensureWorkspaceOwnerSuperAdmin = async (user: any): Promise<any> => {
  if (!user?.id) return user;

  const ownedWorkspace = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
    select: { id: true },
  });
  if (!ownedWorkspace) return user;

  // If owner is already superadmin and linked correctly, keep current user as-is.
  if (
    normalizeRoleKey(user.role?.name || '') === SUPERADMIN_ROLE_NAME &&
    user.workspaceId === ownedWorkspace.id
  ) {
    return user;
  }

  const superAdminRole = await prisma.role.upsert({
    where: {
      workspaceId_name: {
        workspaceId: ownedWorkspace.id,
        name: SUPERADMIN_ROLE_NAME,
      },
    },
    update: {
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
    create: {
      workspaceId: ownedWorkspace.id,
      name: SUPERADMIN_ROLE_NAME,
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
  });

  const permissions = await prisma.permission.findMany({ select: { id: true } });
  if (permissions.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: superAdminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      roleId: superAdminRole.id,
      workspaceId: user.workspaceId || ownedWorkspace.id,
    },
    select: authenticatedUserBaseSelect,
  });
};

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



export const register = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      logger.warn('Failed registration - email already exists', { email, action: 'register_failed' });
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        isEmailVerified: false,
        verificationToken,
        verificationTokenExpires,
      },
    });

    await sendVerificationEmail(user.email, verificationToken);

    await auditService.log({
      userId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
    });
  } catch (error: any) {
    logger.error('Error during registration', { error: error.message, email: req.body.email });
    return res.status(500).json({ message: 'Registration failed' });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Verification token is missing' });
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token as string,
        verificationTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      logger.warn('Invalid or expired verification token', { token, action: 'verify_email_failed' });
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        verificationToken: null,
        verificationTokenExpires: null,
      },
    });

    logger.info('Email verified', { userId: user.id, email: user.email, action: 'verify_email_success' });

    await auditService.log({
      userId: user.id,
      action: 'EMAIL_VERIFIED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f9fafb;">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: #10b981;">Email Verified!</h1>
            <p style="color: #6b7280; font-size: 1.1rem; margin-top: 10px;">Your account has been successfully activated.</p>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login"
               style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Go to Login
            </a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).json({ message: 'Email verification failed' });
  }
};

export const renderResetPasswordPage = async (req: Request, res: Response): Promise<any> => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return res.status(400).send('Invalid reset link.');
  }

  return res.status(200).send(`
    <html>
      <head><title>Reset Password - Seeakk</title></head>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc;">
        <form method="POST" action="/api/auth/reset-password/confirm" style="width: 100%; max-width: 420px; background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.08);">
          <h2 style="margin: 0 0 8px;">Reset your password</h2>
          <p style="margin: 0 0 16px; color: #64748b;">Enter a new password for your account.</p>
          <input type="hidden" name="token" value="${token}" />
          <label style="display:block; margin-bottom: 6px;">New Password</label>
          <input name="newPassword" type="password" minlength="8" required style="width:100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px;" />
          <button type="submit" style="margin-top: 14px; width:100%; border:0; background:#2563eb; color:#fff; padding:10px; border-radius:8px; font-weight:600; cursor:pointer;">Update Password</button>
        </form>
      </body>
    </html>
  `);
};

export const resetPasswordWithToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();

    if (!token || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Valid token and password (min 8 chars) are required.' });
    }

    const jwtSecret = process.env.JWT_SECRET as string;
    if (!jwtSecret) {
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    if (!decoded?.userId || decoded?.purpose !== 'password_reset') {
      return res.status(400).json({ message: 'Invalid reset token payload.' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.deletedAt) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
    await invalidateUserSessions(user.id);

    await auditService.log({
      userId: user.id,
      workspaceId: user.workspaceId || undefined,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#f8fafc;">
          <div style="text-align:center; background:#fff; padding:24px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,.08);">
            <h2 style="margin:0 0 8px; color:#16a34a;">Password Updated</h2>
            <p style="color:#64748b;">Your password has been reset successfully. You can now login with the new password.</p>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="display:inline-block; margin-top:12px; background:#2563eb; color:#fff; text-decoration:none; padding:10px 14px; border-radius:8px;">Go to Login</a>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error('Reset password with token failed', { error: error?.message });
    return res.status(500).json({ message: 'Failed to reset password.' });
  }
};

export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email: rawEmail, password } = req.body;

    if (!rawEmail || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const email = rawEmail.toLowerCase().trim();

    let user: any = await prisma.user.findUnique({
      where: { email },
      select: authenticatedUserBaseSelect,
    });

    if (!user) {
      logger.warn('Login failed - user not found', { email, action: 'login_failed' });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.password) {
      return res.status(400).json({ message: 'Password login is not enabled for this account' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Please verify your email address to log in.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn('Login failed - wrong password', { email, userId: user.id, action: 'login_failed' });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Owner-role sync is best-effort. Login must not fail if this maintenance step errors.
    try {
      user = await ensureWorkspaceOwnerSuperAdmin(user);
    } catch (error: any) {
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      logger.error('Failed to sync workspace owner superadmin role during password login', {
        userId: user.id,
        error: error?.message,
        action: 'login_owner_role_sync_failed',
      });

      // Fall back to current persisted user state so authentication can proceed.
      const fallbackUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: authenticatedUserBaseSelect,
      });
      if (fallbackUser) {
        user = fallbackUser;
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    user = await hydrateAuthenticatedUser(user);

    if (!isRoleScopedToUserWorkspace(user)) {
      logger.error('Login blocked because role is linked to a different workspace', {
        userId: user.id,
        userWorkspaceId: user.workspaceId,
        roleId: user.roleId,
        roleWorkspaceId: user.role?.workspaceId,
      });
      return res.status(403).json({
        message: 'Account role is not valid for this workspace. Please contact support or your administrator.',
      });
    }

    logger.info('Login successful', { email, userId: user.id, action: 'login_success' });

    let tokens;
    try {
      tokens = generateTokens(user as any);
    } catch (error: any) {
      if (error?.statusCode) {
        logger.error('Login token generation failed', {
          userId: user.id,
          error: error.message,
          secretName: error.secretName,
          action: 'login_token_generation_failed',
        });
        return res.status(error.statusCode).json({
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    if (redisClient?.isReady) {
      await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
    } else {
      console.warn('Redis not connected. Skipping refresh token storage for login.');
    }
    // Fire and forget non-critical tracking to drastically speed up login response time
    trackUserDevice(req, user as any).catch(e => console.error('Device track err:', e));
    auditService.log({
      userId: user.id,
      workspaceId: user.workspaceId || undefined,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      details: { method: 'password' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(e => console.error('Audit err:', e));

    const resolvedWorkspaceId = await resolveWorkspaceForAuthPayload(user);

    return res.status(200).json({
      user: serializeAuthenticatedUser(user, resolvedWorkspaceId),
      ...tokens,
    });
  } catch (error: any) {
    console.error('Login error:', error.message, error.stack);
    if (isTransientDatabaseError(error)) {
      return res.status(503).json({
        message: 'Database connection is temporarily unavailable. Please try again shortly.',
        code: error?.code,
      });
    }
    if (isPrismaSchemaMismatchError(error)) {
      return res.status(503).json({
        message: 'Authentication service is temporarily unavailable due to database schema mismatch. Run migrations and retry.',
        code: error.code,
      });
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: 'Login failed', details: error.message });
  }
};

export const googleLogin = async (req: Request, res: Response): Promise<any> => {
  try {
    logger.debug('Incoming Google login request', {
      action: 'google_login_request',
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    });

    const token = extractGoogleCredentialToken(req.body);

    if (!token) {
      logger.warn('Google login request missing credential token', {
        action: 'google_login_missing_token',
        bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
      });
      return res.status(400).json({ message: 'Google credential token is required' });
    }

    if (typeof token !== 'string' || token.split('.').length !== 3) {
      return res.status(400).json({ message: 'Send a valid Google ID token (JWT), not Google client ID' });
    }

    let payload: any;
    try {
      payload = await verifyGoogleToken(token);
    } catch (error: any) {
      if (error?.statusCode === 503) {
        logger.error('Google login backend misconfiguration', {
          error: error.message,
          action: 'google_login_config_error',
        });
        return res.status(503).json({ message: 'Google login is not configured on server. Please contact support.' });
      }
      logger.warn('Google login verification failed', { error: error.message, action: 'google_login_failed' });
      return res.status(401).json({ message: 'Invalid or expired Google token' });
    }

    const { email: googleEmail, name, sub, email_verified: emailVerified } = payload;
    if (typeof googleEmail !== 'string' || !googleEmail.trim()) {
      return res.status(400).json({ message: 'Google account email is missing' });
    }
    const email = googleEmail.toLowerCase().trim();
    if (typeof sub !== 'string' || !sub.trim()) {
      return res.status(400).json({ message: 'Google account identifier is missing' });
    }
    if (emailVerified === false) {
      return res.status(403).json({ message: 'Google account email is not verified' });
    }

    // 1. Try to find the user by googleId FIRST (Most reliable identifier)
    let user: any = await prisma.user.findUnique({
      where: { googleId: sub },
      select: authenticatedUserBaseSelect,
    });

    // 2. If not found by googleId, try finding by email
    if (!user) {
      user = await prisma.user.findUnique({
        where: { email },
        select: authenticatedUserBaseSelect,
      });

      // 3. If found by email, safely link the googleId to this account
      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: sub, isEmailVerified: true },
          select: authenticatedUserBaseSelect,
        });
      }
    }

    // 4. If still not found, safely create a new user
    if (!user) {
      user = await prisma.user.create({
        data: {
          name,
          email,
          googleId: sub,
          isEmailVerified: true,
        },
        select: authenticatedUserBaseSelect,
      });
    }

    // Owner-role sync is best-effort. Login must not fail if this maintenance step errors.
    try {
      user = await ensureWorkspaceOwnerSuperAdmin(user);
    } catch (error: any) {
      logger.error('Failed to sync workspace owner superadmin role during Google login', {
        userId: user?.id,
        error: error?.message,
        action: 'google_login_owner_role_sync_failed',
      });

      // Fall back to current persisted state to allow login to proceed
      if (user?.id) {
        const fallbackUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: authenticatedUserBaseSelect,
        });
        if (fallbackUser) user = fallbackUser;
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    user = await hydrateAuthenticatedUser(user);

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    if (!isRoleScopedToUserWorkspace(user)) {
      logger.error('Google login blocked because role is linked to a different workspace', {
        userId: user.id,
        userWorkspaceId: user.workspaceId,
        roleId: user.roleId,
        roleWorkspaceId: user.role?.workspaceId,
        action: 'google_login_role_workspace_mismatch',
      });
      return res.status(403).json({
        message: 'Account role is not valid for this workspace. Please contact support or your administrator.',
      });
    }

    let tokens;
    try {
      tokens = generateTokens(user as any);
    } catch (error: any) {
      if (error?.statusCode) {
        logger.error('Google login token generation failed', {
          userId: user.id,
          error: error.message,
          secretName: error.secretName,
          action: 'google_login_token_generation_failed',
        });
        return res.status(error.statusCode).json({
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    if (redisClient?.isReady) {
      try {
        await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
      } catch (redisError: any) {
        logger.warn('Failed to store refresh token in Redis during Google login', {
          userId: user.id,
          error: redisError?.message,
        });
      }
    } else {
      console.warn('Redis not connected. Skipping refresh token storage for Google login.');
    }

    logger.info('Google login successful', { email: user.email, userId: user.id, action: 'google_login_success' });
    // Fire and forget non-critical tracking to drastically speed up login response time
    trackUserDevice(req, user as any).catch(e => console.error('Device track err:', e));
    auditService.log({
      userId: user.id,
      workspaceId: user.workspaceId || undefined,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      details: { method: 'google' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(e => console.error('Audit err:', e));

    const resolvedWorkspaceId = await resolveWorkspaceForAuthPayload(user);

    return res.status(200).json({
      user: serializeAuthenticatedUser(user, resolvedWorkspaceId),
      ...tokens,
    });
  } catch (error: any) {
    logger.error('Google login failed unexpectedly', {
      error: error?.message,
      stack: error?.stack,
      code: error?.code,
      action: 'google_login_unexpected_error',
    });

    if (isTransientDatabaseError(error)) {
      return res.status(503).json({
        message: 'Database connection is temporarily unavailable. Please try again shortly.',
        code: error?.code,
      });
    }

    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'An account conflict occurred while linking Google login.' });
    }
    if (isPrismaSchemaMismatchError(error)) {
      return res.status(503).json({
        message: 'Google login is temporarily unavailable due to database schema mismatch. Run migrations and retry.',
        code: error.code,
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
      });
    }

    return res.status(500).json({ 
      message: 'Google login failed. Please try again shortly.',
      error: error?.message,
      code: error?.code,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      telemetry: {
        hasBody: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const { userId, tokenId } = decoded;

    if (!redisClient?.isReady) {
      logger.warn('Refresh token rejected - Redis session store not ready', { userId, tokenId, action: 'refresh_redis_unready' });
      return res.status(503).json({ message: 'Session service temporarily unavailable. Please try again shortly.' });
    }

    const storedUserId = await redisClient.get(`refresh:${tokenId}`);
    if (!storedUserId || storedUserId !== userId) {
      logger.warn('Refresh token rejected - stolen or already used', { userId, tokenId, action: 'refresh_token_rejected' });
      return res.status(401).json({ message: 'Invalid refresh token or already consumed' });
    }

    // Rotate - invalidate old token
    await redisClient.del(`refresh:${tokenId}`);

    let user: any = await prisma.user.findUnique({
      where: { id: userId },
      select: authenticatedUserBaseSelect,
    });

    if (!user || !user.isActive) {
      return res.status(403).json({ message: 'User not found or inactive' });
    }

    try {
      user = await ensureWorkspaceOwnerSuperAdmin(user);
    } catch (error: any) {
      logger.error('Failed to sync workspace owner superadmin role during token refresh', {
        userId: user?.id,
        error: error?.message,
        action: 'refresh_owner_role_sync_failed',
      });
      if (user?.id) {
        const fallbackUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: authenticatedUserBaseSelect,
        });
        if (fallbackUser) user = fallbackUser;
      }
    }

    if (!user) {
      return res.status(403).json({ message: 'User not found or inactive' });
    }
    user = await hydrateAuthenticatedUser(user);

    if (!isRoleScopedToUserWorkspace(user)) {
      return res.status(403).json({
        message: 'Account role is not valid for this workspace. Please contact support or your administrator.',
      });
    }

    let tokens;
    try {
      tokens = generateTokens(user as any);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
    trackUserDevice(req, user as any).catch((e) => console.error('Device track err:', e));

    const resolvedWorkspaceId = await resolveWorkspaceForAuthPayload(user);

    return res.status(200).json({
      user: serializeAuthenticatedUser(user, resolvedWorkspaceId),
      ...tokens,
    });
  } catch (error) {
    const err: any = error;
    if (isTransientDatabaseError(err)) {
      return res.status(503).json({
        message: 'Database connection is temporarily unavailable. Please try again shortly.',
        code: err?.code,
      });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        message: err.message,
        code: err.code,
      });
    }
    return res.status(500).json({ message: 'Failed to refresh token' });
  }
};

export const logout = async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(200).json({ message: 'Logged out successfully' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string, { ignoreExpiration: true });
    } catch {
      return res.status(200).json({ message: 'Logged out successfully' });
    }

    if (decoded?.tokenId) {
      await redisClient.del(`refresh:${decoded.tokenId}`);

      await auditService.log({
        userId: decoded.userId,
        action: 'USER_LOGOUT',
        entityType: 'User',
        entityId: decoded.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Logout failed' });
  }
};

export const getMe = async (req: Request, res: Response): Promise<any> => {
  try {
    let user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    user = await hydrateAuthenticatedUser(user);
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const resolvedWorkspaceId = await resolveWorkspaceForAuthPayload(user);

    return res.status(200).json({
      user: serializeAuthenticatedUser(user, resolvedWorkspaceId),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user profile' });
  }
};

export const listUsers = async (req: Request, res: Response): Promise<any> => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const page = parsePositiveInt(req.query.page, 1);
    const requestedLimit = parsePositiveInt(req.query.limit, 20);
    const limit = Math.min(requestedLimit, 100);
    const skip = (page - 1) * limit;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where = {
      ...(currentUser.workspaceId ? { workspaceId: currentUser.workspaceId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          isEmailVerified: true,
          isOnboarded: true,
          createdAt: true,
          updatedAt: true,
          role: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          _count: {
            select: { devices: true },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching paginated users', {
      error: error.message,
      action: 'list_users_failed',
    });
    return res.status(500).json({ message: 'Failed to fetch users' });
  }
};
