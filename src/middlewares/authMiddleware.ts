import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import logger from '../utils/logger';
import { redisClient } from '../config/redis';
import { enforceMandatoryFollowUpContinuation } from './mandatoryFollowupMiddleware';
import { enforceOverdueFollowUp } from './overdueFollowupMiddleware';
import { isFollowUpLockResolutionPath } from '../utils/followUpLockExemptPaths';
import { userHasActiveTemporaryBulkExtensionAccess } from '../modules/followup-settings/temporaryBulkAccess.util';
import { BULK_EXTEND_FOLLOWUPS_PERMISSION } from '../utils/authSerializers';
import { applyCorsHeadersIfAllowed } from '../config/cors';

interface JwtPayload {
  userId: string;
}

const SUPERADMIN_ROLE_NAME = 'superadmin';

const normalizeRoleKey = (role: string): string =>
  role
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const isPrivilegedRole = (role?: string | null): boolean => {
  const normalized = normalizeRoleKey(role || '');
  // Only workspace owners (superadmin) get global permission bypass.
  return normalized === 'superadmin';
};

const isRoleScopedToUserWorkspace = (user: any): boolean => {
  if (!user?.roleId || !user?.workspaceId || !user?.role?.workspaceId) {
    return true;
  }

  return user.role.workspaceId === user.workspaceId;
};

const ensureWorkspaceOwnerSuperAdmin = async (user: any): Promise<any> => {
  if (!user?.id) return user;

  const ownedWorkspace = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
    select: { id: true },
  });
  if (!ownedWorkspace) return user;

  // If owner is already superadmin and linked to workspace, nothing to repair.
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

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      roleId: superAdminRole.id,
      workspaceId: user.workspaceId || ownedWorkspace.id,
    },
    include: {
      role: true,
      workspace: {
        select: {
          id: true,
          companyName: true,
          logoUrl: true,
          billingStatus: true,
          accessUntil: true,
          lockedAt: true,
          suspendReason: true,
        },
      },
    },
  });

  logger.info('Promoted workspace owner to superadmin during auth', {
    userId: user.id,
    workspaceId: ownedWorkspace.id,
    action: 'owner_auto_superadmin',
  });

  return updatedUser;
};

const maskAuthHeader = (authHeader?: string): string => {
  if (!authHeader) return 'NOTHING RECEIVED';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '[NON_BEARER_TOKEN_REDACTED]';
  const token = authHeader.substring(7).trim();
  if (!token) return 'Bearer [EMPTY]';
  const prefix = token.slice(0, 8);
  const suffix = token.slice(-6);
  return `Bearer ${prefix}...${suffix}`;
};

/**
 * Protect routes - Verifies JWT and injects User object (with role) into req
 */
export const protect = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const isLocationTrackingRequest = req.originalUrl?.includes('/location-tracking') || req.path?.includes('/location-tracking');

  try {
    let token: string | null = null;
    const authHeader = req.headers.authorization || req.header('Authorization');

    if (isLocationTrackingRequest || process.env.AUTH_DEBUG === 'true') {
      logger.info('Location Tracking Request -> Authorization Header Check', {
        path: req.originalUrl || req.path,
        method: req.method,
        authString: maskAuthHeader(authHeader),
      });
    }

    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    if (!token && req.headers['x-access-token']) {
      token = (req.headers['x-access-token'] as string).trim();
    }

    if (token === 'null' || token === 'undefined' || token === '') {
      token = null;
    }

    if (!token) {
      logger.warn('Access denied. Token missing from request header.', {
        action: 'auth_missing_token',
        path: req.originalUrl || req.path,
        method: req.method,
        ip: req.ip,
        reason: 'Token missing',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(401).json({
        message: 'Not authorized to access this route. Token missing.',
        diagnostic: "Send an 'Authorization: Bearer <token>' header.",
        rawHeaderReceived: maskAuthHeader(authHeader),
        reason: 'Token missing',
      });
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        clockTolerance: 30,
      }) as JwtPayload;
    } catch (jwtErr: any) {
      const reason = jwtErr.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid signature';
      logger.warn(`Access denied. JWT validation failed: ${reason}`, {
        action: 'auth_jwt_invalid',
        path: req.originalUrl || req.path,
        method: req.method,
        ip: req.ip,
        reason,
        errorMessage: jwtErr.message,
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(401).json({
        message: 'Not authorized. Token failed or expired.',
        diagnosticReason: jwtErr.message,
        reason,
        solution: 'Please log in again to receive a fresh, valid token.',
      });
    }

    if (isLocationTrackingRequest) {
      logger.info('Location Tracking Request -> JWT Validation Success', {
        userId: decoded.userId,
        path: req.originalUrl || req.path,
      });
    }

    // Fetch user from PostgreSQL via Prisma with role included
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        role: true,
        workspace: {
          select: {
            id: true,
            companyName: true,
            logoUrl: true,
          },
        },
      },
    });

    if (!user || user.deletedAt !== null) {
      logger.warn('Access denied. Token user no longer exists or is deleted.', {
        userId: decoded.userId,
        action: 'auth_ghost_user',
        reason: 'User deleted',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(401).json({ message: 'The user belonging to this token no longer exists or has been deleted.', reason: 'User deleted' });
    }

    if (!user.isActive) {
      logger.warn('Access denied. User is inactive/disabled.', { userId: user.id, action: 'auth_inactive_user', reason: 'User disabled' });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({ message: 'User account is suspended or inactive.', reason: 'User disabled' });
    }

    const isWorkspaceOnboardingPath =
      req.originalUrl?.includes('/workspace/setup') ||
      req.originalUrl?.includes('/workspace/config-meta') ||
      req.path?.includes('/workspace/setup') ||
      req.path?.includes('/workspace/config-meta') ||
      req.path === '/setup' ||
      req.path === '/config-meta';

    if (!user.workspaceId && !isWorkspaceOnboardingPath) {
      logger.warn('Access denied. User workspace missing.', { userId: user.id, action: 'auth_missing_workspace', reason: 'Workspace missing' });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({ message: 'User account is not associated with an active workspace.', reason: 'Workspace missing' });
    }

    const hydratedUser = await ensureWorkspaceOwnerSuperAdmin(user);

    if (!isRoleScopedToUserWorkspace(hydratedUser)) {
      logger.error('Access denied. Role belongs to a different workspace.', {
        userId: hydratedUser.id,
        userWorkspaceId: hydratedUser.workspaceId,
        roleId: hydratedUser.roleId,
        roleWorkspaceId: hydratedUser.role?.workspaceId,
        action: 'auth_role_workspace_mismatch',
        reason: 'Workspace role mismatch',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({
        message: 'Forbidden: The assigned role does not belong to this workspace.',
        reason: 'Workspace role mismatch',
      });
    }

    req.user = hydratedUser;

    if (isLocationTrackingRequest) {
      logger.info('Location Tracking Request -> Authenticated User', {
        userId: hydratedUser.id,
        workspaceId: hydratedUser.workspaceId,
        roleId: hydratedUser.roleId,
        roleName: hydratedUser.role?.name,
      });
    }

    if (isWorkspaceOnboardingPath || isFollowUpLockResolutionPath(req)) {
      return next();
    }

    const isSubscriptionPath = req.originalUrl?.includes('/api/subscription') || req.path?.includes('/subscription');
    
    // Centralized Access Priority Guard (Phase 3)
    if (!isSubscriptionPath && hydratedUser.workspace) {
      const workspace = hydratedUser.workspace;
      const now = new Date();

      if (workspace.suspendReason) {
        applyCorsHeadersIfAllowed(req, res);
        return res.status(403).json({ message: 'Workspace is suspended.', reason: 'Suspended' });
      }

      if (workspace.lockedAt) {
        applyCorsHeadersIfAllowed(req, res);
        return res.status(403).json({ message: 'Workspace is locked by administration.', reason: 'Locked' });
      }

      const hasPaidAccess = workspace.accessUntil && workspace.accessUntil > now;
      let hasGraceAccess = false;

      // Check Grace only if not paid and enrolled in new billing
      if (!hasPaidAccess && workspace.billingStatus) {
        const grace = await (prisma as any).graceRecord.findFirst({
          where: { workspaceId: workspace.id, status: 'ACTIVE', graceUntil: { gt: now } }
        });
        if (grace) {
          hasGraceAccess = true;
        }
      }

      if (!hasPaidAccess && !hasGraceAccess && workspace.billingStatus) {
        // Enforce expiration
        if (workspace.accessUntil && workspace.accessUntil <= now && workspace.billingStatus === 'ACTIVE') {
          // Fire-and-forget DB update to sync status for transparency
          (prisma as any).workspace.update({
            where: { id: workspace.id },
            data: { billingStatus: 'EXPIRED' }
          }).catch(console.error);
          workspace.billingStatus = 'EXPIRED'; // Reflect in memory
        }

        const billingStatus = workspace.billingStatus;
        if (['PAYMENT_REQUIRED', 'PAYMENT_PENDING', 'EXPIRED'].includes(billingStatus)) {
          logger.warn('Access denied. Workspace billing requires attention.', {
            userId: hydratedUser.id,
            workspaceId: hydratedUser.workspaceId,
            billingStatus,
            action: 'auth_billing_blocked',
          });
          applyCorsHeadersIfAllowed(req, res);
          return res.status(402).json({
            message: 'Payment is required to access this workspace.',
            billingStatus,
            reason: 'Payment required',
          });
        }
      }
    }

    return enforceOverdueFollowUp(req, res, () =>
      enforceMandatoryFollowUpContinuation(req, res, next),
    );
  } catch (error: any) {
    logger.error('Authentication Error', { error: error.message, action: 'auth_failed' });
    applyCorsHeadersIfAllowed(req, res);
    return res.status(401).json({
      message: 'Not authorized. Token failed or expired.',
      diagnosticReason: error.message,
      reason: 'Authentication error',
      solution: 'Please log in again to receive a fresh, valid token.',
    });
  }
};

/**
 * Role-Based Access Control (RBAC)
 * @param {string[]} roles - Permitted role names
 */
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!req.user || !req.user.role) {
      logger.warn('Access forbidden. User has no assigned role.', {
        userId: req.user?.id,
        action: 'rbac_forbidden_no_role',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({ message: 'Forbidden: You do not have an assigned role.' });
    }

    const userRole = req.user.role.name;
    const normalizedUserRole = normalizeRoleKey(userRole);
    const normalizedAllowedRoles = roles.map((role) => normalizeRoleKey(role));

    if (isPrivilegedRole(userRole)) {
      return next();
    }

    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      logger.warn(`Access forbidden. Required: ${roles.join(', ')}, Found: ${userRole}`, {
        userId: req.user.id,
        role: userRole,
        action: 'rbac_forbidden',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({
        message: `Forbidden: The '${userRole}' role is not authorized to access this route.`,
      });
    }

    next();
  };
};

/**
 * Permission-Based Access Control
 * @param {string} permissionKey - Required permission key
 */
export const checkPermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user || !req.user.roleId) {
      logger.warn('Permission denied. User has no assigned role.', {
        userId: req.user?.id,
        action: 'permission_denied_no_role',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have an assigned role.',
      });
    }

    const roleId = req.user.roleId;
    const cacheKey = `role_permissions:${roleId}`;

    try {
      if (isPrivilegedRole(req.user.role?.name)) {
        return next();
      }

      let permissions: string[] = [];

      // 1. Try to get from Redis
      if (redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          logger.info(`RBAC DEBUG: Found cached permissions for role ${roleId}`);
          permissions = JSON.parse(cached);
        }
      }

      logger.info(`RBAC DEBUG: Checking permission ${permissionKey} for role ${roleId}. Current perms count: ${permissions.length}`);

      // 2. Fetch from DB if not in cache
      if (permissions.length === 0) {
        const rolePermissions = await (prisma as any).rolePermission.findMany({
          where: { roleId },
          include: { permission: { select: { key: true } } },
        });

        permissions = rolePermissions.map((rp: any) => rp.permission.key);

        logger.info(`RBAC DEBUG: Fetched ${permissions.length} perms from DB for role ${roleId}`);

        // 3. Store in Redis (1 hour cache)
        if (redisClient.isOpen && permissions.length > 0) {
          await redisClient.setEx(cacheKey, 3600, JSON.stringify(permissions));
        }
      }

      // 4. Check permission
      let hasRequestedPermission = permissions.includes(permissionKey) || permissions.includes('SUPERADMIN') || permissions.includes('*');
      if (!hasRequestedPermission && permissionKey === BULK_EXTEND_FOLLOWUPS_PERMISSION) {
        hasRequestedPermission = await userHasActiveTemporaryBulkExtensionAccess(
          req.user.id,
          req.user.workspaceId,
        );
      }
      const hasLeadSourceFallbackPermission =
        permissionKey.startsWith('LEAD_SOURCES_') && permissions.includes('SYSTEM_CONFIG');
      const hasLeadStageFallbackPermission =
        permissionKey.startsWith('LEAD_STAGES_') && permissions.includes('SYSTEM_CONFIG');
      const hasStageRuleFallbackPermission =
        permissionKey.startsWith('LEAD_STAGE_RULES_') && permissions.includes('SYSTEM_CONFIG');
      const hasTargetCycleFallbackPermission =
        permissionKey.startsWith('TARGET_CYCLES_') && permissions.includes('SYSTEM_CONFIG');
      const hasLocationFallbackPermission =
        (permissionKey.startsWith('LOCATION_') || permissionKey.startsWith('OFFICE_LOCATION_')) &&
        (permissions.includes('SYSTEM_CONFIG') || permissions.includes('manage_attendance_locations'));
      const hasDashboardFallbackPermission =
        permissionKey.startsWith('DASHBOARD_') &&
        (permissions.includes('SYSTEM_CONFIG') ||
         permissions.includes('LEADS_VIEW_ALL') ||
         permissions.includes('DASHBOARD_VIEW_ALL') ||
         permissions.includes('DASHBOARD_VIEW_ASSIGNED') ||
         permissions.includes('DASHBOARD_VIEW_OWN') ||
         permissions.includes('DASHBOARD_VIEW_ALL_OFFICES') ||
         permissions.includes('DASHBOARD_VIEW_ASSIGNED_OFFICES') ||
         permissions.includes('DASHBOARD_VIEW_OWN_OFFICE'));
      const hasHolidayFallbackPermission =
        permissionKey.startsWith('HOLIDAY_') && permissions.includes('SYSTEM_CONFIG');
      const hasAttendanceMarkFallback =
        permissionKey === 'mark_attendance' &&
        (permissions.includes('view_attendance') ||
          permissions.includes('view_own_attendance') ||
          permissions.includes('manage_attendance'));

      if (
        !hasRequestedPermission &&
        !hasLeadSourceFallbackPermission &&
        !hasLeadStageFallbackPermission &&
        !hasStageRuleFallbackPermission &&
        !hasTargetCycleFallbackPermission &&
        !hasLocationFallbackPermission &&
        !hasDashboardFallbackPermission &&
        !hasHolidayFallbackPermission &&
        !hasAttendanceMarkFallback
      ) {
        logger.warn(`Permission denied. Required: ${permissionKey}. User has: ${permissions.join(', ')}`, {
          userId: req.user.id,
          roleId,
          action: 'permission_denied',
        });
        applyCorsHeadersIfAllowed(req, res);
        return res.status(403).json({
          success: false,
          errorCode: 'PERMISSION_DENIED',
          message: `Access denied. You need the '${permissionKey}' permission.`,
          debug: {
            required: permissionKey,
            holdingCount: permissions.length,
            roleId: roleId
          }
        });
      }

      next();
    } catch (error: any) {
      logger.error('Error checking permissions', { error: error.message, userId: req.user.id });
      // Fallback to DB if Redis fails (already handled by permissions.length === 0 check above)
      applyCorsHeadersIfAllowed(req, res);
      return res.status(500).json({ success: false, message: 'Internal server error while checking permissions.' });
    }
  };
};

export const checkAnyPermission = (permissionKeys: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user || !req.user.roleId) {
      logger.warn('Permission denied. User has no assigned role.', {
        userId: req.user?.id,
        action: 'permission_denied_no_role',
      });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have an assigned role.',
      });
    }

    const roleId = req.user.roleId;
    const cacheKey = `role_permissions:${roleId}`;

    try {
      if (isPrivilegedRole(req.user.role?.name)) {
        return next();
      }

      let permissions: string[] = [];

      if (redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          permissions = JSON.parse(cached);
        }
      }

      if (permissions.length === 0) {
        const rolePermissions = await (prisma as any).rolePermission.findMany({
          where: { roleId },
          include: { permission: { select: { key: true } } },
        });

        permissions = rolePermissions.map((rp: any) => rp.permission.key);

        if (redisClient.isOpen && permissions.length > 0) {
          await redisClient.setEx(cacheKey, 3600, JSON.stringify(permissions));
        }
      }

      logger.info(
        `RBAC DEBUG: Checking permissions [${permissionKeys.join(', ')}] for role ${roleId}. Current perms count: ${permissions.length}`,
      );

      const hasTemporaryBulkExtension = await userHasActiveTemporaryBulkExtensionAccess(
        req.user.id,
        req.user.workspaceId,
      );
      const hasMatch = permissionKeys.some((permissionKey) => {
        if (permissions.includes(permissionKey) || permissions.includes('SUPERADMIN') || permissions.includes('*')) return true;
        if (permissionKey === BULK_EXTEND_FOLLOWUPS_PERMISSION && hasTemporaryBulkExtension) {
          return true;
        }
        return false;
      });
      const hasAttendanceModuleFallback =
        !hasMatch &&
        permissionKeys.some((key) => key.includes('attendance')) &&
        permissions.some((key) => key.includes('attendance'));

      if (!hasMatch && !hasAttendanceModuleFallback) {
        logger.warn(`Permission denied. Required one of: ${permissionKeys.join(', ')}`, {
          userId: req.user.id,
          roleId,
          action: 'permission_denied_any',
        });

        applyCorsHeadersIfAllowed(req, res);
        return res.status(403).json({
          success: false,
          errorCode: 'PERMISSION_DENIED',
          message: `Access denied. You need one of these permissions: ${permissionKeys.join(', ')}.`,
        });
      }

      next();
    } catch (error: any) {
      logger.error('Error checking permissions', { error: error.message, userId: req.user.id });
      applyCorsHeadersIfAllowed(req, res);
      return res.status(500).json({ success: false, message: 'Internal server error while checking permissions.' });
    }
  };
};
export const hasPermission = async (user: any, permissionKey: string): Promise<boolean> => {
  if (!user || !user.roleId) return false;
  if (user.roleId === 'system_role' || user.email === 'system@automation.seeakk.com' || user.role?.name === 'system_admin' || user.role?.name === 'superadmin') {
    return true;
  }
  if (isPrivilegedRole(user.role?.name)) return true;

  if (permissionKey === BULK_EXTEND_FOLLOWUPS_PERMISSION) {
    if (await userHasActiveTemporaryBulkExtensionAccess(user.id, user.workspaceId)) {
      return true;
    }
  }

  const rolePermissions = await (prisma as any).rolePermission.findMany({
    where: { roleId: user.roleId },
    include: { permission: { select: { key: true } } },
  });

  const permissions = rolePermissions.map((rp: any) => rp.permission.key);
  return permissions.includes(permissionKey) || permissions.includes('SUPERADMIN') || permissions.includes('*');
};
