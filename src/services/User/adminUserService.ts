import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import { sendPasswordResetEmail } from '../Email/emailService';
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateStatusInput,
  ResetPasswordInput,
  ListUsersQuery,
} from '../../validations/adminUserValidation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a cryptographically secure random password */
const generateSecurePassword = (): string => crypto.randomBytes(12).toString('base64url');

/**
 * Invalidate all Redis refresh tokens belonging to a specific userId.
 * Redis SCAN iterates all `refresh:*` keys and deletes matches.
 */
const invalidateUserSessions = async (userId: string): Promise<void> => {
  try {
    if (!redisClient.isOpen) return;

    // Redis client expects number cursor
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
  } catch (err: any) {
    logger.warn('Failed to invalidate Redis sessions for user', { userId, error: err.message });
  }
};

// ─── Prisma select shape ──────────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  phone: true,
  isActive: true,
  isEmailVerified: true,
  isOnboarded: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, description: true } },
  department: { select: { id: true, name: true, description: true } },
  supervisor: { select: { id: true, name: true, email: true } },
  office: { select: { id: true, name: true } },
  country: { select: { id: true, name: true } },
  state: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  assignedLocations: {
    select: {
      location: { select: { id: true, name: true, type: true } },
    },
  },
  workspace: { select: { id: true, companyName: true } },
} as const;

const resolveRoleId = async (value: string): Promise<string | null> => {
  const role = await prisma.role.findFirst({
    where: {
      OR: [
        { id: value },
        { name: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return role?.id ?? null;
};

const resolveDepartmentId = async (value: string, workspaceId: string): Promise<string | null> => {
  const department = await (prisma as any).department.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { id: value },
        { name: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return (department as any)?.id ?? null;
};

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Create a new user inside a workspace.
 * Admin-created users are pre-verified and immediately active.
 */
export const createUser = async (input: CreateUserInput, workspaceId: string) => {
  const {
    name,
    username,
    email,
    password,
    phone,
    roleId,
    departmentId,
    supervisorId,
    officeId,
    countryId,
    stateId,
    districtId,
    assignedLocationIds,
  } = input;

  // 1. Email and Username uniqueness (supports restore from soft-deleted record)
  const existingEmail = await (prisma as any).user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
    },
    select: {
      id: true,
      email: true,
      deletedAt: true,
    },
  });

  const canRestoreSoftDeletedByEmail = Boolean(existingEmail && existingEmail.deletedAt);
  if (existingEmail && !canRestoreSoftDeletedByEmail) {
    const err: any = new Error('A user with this email already exists.');
    err.statusCode = 409;
    throw err;
  }

  if (username) {
    const existingUsername = await (prisma as any).user.findUnique({ where: { username } });
    if (existingUsername) {
      const err: any = new Error('This username is already taken.');
      err.statusCode = 409;
      throw err;
    }
  }

  // 2. Resolve/validate roleId (supports id or role name)
  const normalizedRoleId = roleId ? await resolveRoleId(roleId) : null;
  if (roleId) {
    if (!normalizedRoleId) {
      const err: any = new Error(`Role with ID '${roleId}' does not exist.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // 3. Resolve/validate relations belong to this workspace
  const normalizedDepartmentId = departmentId ? await resolveDepartmentId(departmentId, workspaceId) : null;
  if (departmentId) {
    if (!normalizedDepartmentId) {
      const err: any = new Error('Department not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  if (officeId) {
    const office = await (prisma as any).office.findFirst({
      where: { id: officeId, workspaceId },
    });
    if (!office) {
      const err: any = new Error('Office not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  // 4. Validate supervisorId belongs to this workspace
  if (supervisorId) {
    const supervisor = await prisma.user.findFirst({
      where: { id: supervisorId, workspaceId } as any,
    });
    if (!supervisor) {
      const err: any = new Error('Supervisor not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  // 5. Hash password (or auto-generate one)
  const rawPassword = password || generateSecurePassword();
  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const createData = {
    name,
    username: username ?? null,
    email,
    password: hashedPassword,
    phone: phone ?? null,
    isEmailVerified: true,
    isActive: true,
    isOnboarded: false,
    workspaceId,
    roleId: normalizedRoleId,
    departmentId: normalizedDepartmentId,
    supervisorId: supervisorId ?? null,
    officeId: officeId ?? null,
    countryId: countryId ?? null,
    stateId: stateId ?? null,
    districtId: districtId ?? null,
    assignedLocations:
      assignedLocationIds && assignedLocationIds.length > 0
        ? {
            create: assignedLocationIds.map((locId) => ({
              locationId: locId,
              workspaceId,
            })),
          }
        : undefined,
  };

  let user: any;

  if (canRestoreSoftDeletedByEmail && existingEmail) {
    user = await prisma.$transaction(
      async (tx) => {
        // Clear historical visibility assignments before restoring account.
        await (tx as any).userLocationAssignment.deleteMany({
          where: { userId: existingEmail.id },
        });

        return (tx as any).user.update({
          where: { id: existingEmail.id },
          data: {
            ...createData,
            deletedAt: null,
          },
          select: USER_SELECT,
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  } else {
    // Avoid interactive transaction for normal creates; a single write is faster and
    // prevents "Transaction already closed" timeouts under transient latency spikes.
    user = await (prisma as any).user.create({
      data: createData,
      select: USER_SELECT,
    });
  }

  logger.info('Admin created new user', { newUserId: user.id, email: user.email, workspaceId });

  return {
    user,
    ...(password ? {} : { generatedPassword: rawPassword }),
  };
};

/**
 * List users in the workspace with pagination + filtering.
 * Always filters by workspaceId and excludes soft-deleted users.
 */
export const listUsers = async (query: ListUsersQuery, workspaceId: string) => {
  const { page, limit, search, roleId, isActive, email } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    workspaceId,
    deletedAt: null,
    ...(isActive !== undefined ? { isActive } : {}),
    ...(roleId ? { roleId } : {}),
    ...(email ? { email: { contains: email, mode: 'insensitive' } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, users] = await prisma.$transaction([
    (prisma as any).user.count({ where }),
    (prisma as any).user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: USER_SELECT,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

/**
 * Get a single user by ID, scoped to the workspace.
 */
export const getUserById = async (id: string, workspaceId: string) => {
  const user = await (prisma as any).user.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: {
      ...USER_SELECT,
      _count: { select: { devices: true, subordinates: true } },
    },
  });

  if (!user) {
    const err: any = new Error('User not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  return user;
};

/**
 * Update user fields (profile, role, department, supervisor).
 */
export const updateUser = async (id: string, input: UpdateUserInput, workspaceId: string) => {
  const existing = await (prisma as any).user.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) {
    const err: any = new Error('User not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  const normalizedRoleId =
    input.roleId !== undefined
      ? input.roleId
        ? await resolveRoleId(input.roleId)
        : null
      : undefined;
  if (input.roleId) {
    if (!normalizedRoleId) {
      const err: any = new Error(`Role with ID '${input.roleId}' does not exist.`);
      err.statusCode = 400;
      throw err;
    }
  }

  const normalizedDepartmentId =
    input.departmentId !== undefined
      ? input.departmentId
        ? await resolveDepartmentId(input.departmentId, workspaceId)
        : null
      : undefined;
  if (input.departmentId) {
    if (!normalizedDepartmentId) {
      const err: any = new Error('Department not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  if (input.supervisorId) {
    if (input.supervisorId === id) {
      const err: any = new Error('A user cannot be their own supervisor.');
      err.statusCode = 400;
      throw err;
    }
    const supervisor = await (prisma as any).user.findFirst({
      where: { id: input.supervisorId, workspaceId, deletedAt: null },
    });
    if (!supervisor) {
      const err: any = new Error('Supervisor not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  if (input.officeId) {
    const office = await (prisma as any).office.findFirst({
      where: { id: input.officeId, workspaceId },
    });
    if (!office) {
      const err: any = new Error('Office not found in this workspace.');
      err.statusCode = 400;
      throw err;
    }
  }

  if (input.username) {
    const existingUsername = await (prisma as any).user.findFirst({
      where: { username: input.username, NOT: { id } },
    });
    if (existingUsername) {
      const err: any = new Error('This username is already taken.');
      err.statusCode = 409;
      throw err;
    }
  }

  // Handle Location Assignments
  if (input.assignedLocationIds !== undefined) {
    // Delete existing
    await (prisma as any).userLocationAssignment.deleteMany({
      where: { userId: id },
    });

    // Sessions must be refreshed to apply new boundary logic
    await invalidateUserSessions(id);
  }

  const user = await (prisma as any).user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(normalizedRoleId !== undefined ? { roleId: normalizedRoleId } : {}),
      ...(normalizedDepartmentId !== undefined ? { departmentId: normalizedDepartmentId } : {}),
      ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
      ...(input.officeId !== undefined ? { officeId: input.officeId } : {}),
      ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
      ...(input.stateId !== undefined ? { stateId: input.stateId } : {}),
      ...(input.districtId !== undefined ? { districtId: input.districtId } : {}),
      ...(input.isEmailVerified !== undefined ? { isEmailVerified: input.isEmailVerified } : {}),
      ...(input.assignedLocationIds !== undefined && input.assignedLocationIds.length > 0
        ? {
            assignedLocations: {
              create: input.assignedLocationIds.map((locId) => ({
                locationId: locId,
                workspaceId,
              })),
            },
          }
        : {}),
    },
    select: USER_SELECT,
  });

  logger.info('Admin updated user', { id, workspaceId, changes: Object.keys(input) });

  return user;
};

/**
 * Soft-delete a user — sets deletedAt and deactivates the account.
 * Also invalidates all active sessions.
 */
export const deleteUser = async (id: string, workspaceId: string, requestingUserId: string) => {
  if (id === requestingUserId) {
    const err: any = new Error('Admins cannot delete their own account.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await (prisma as any).user.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) {
    const err: any = new Error('User not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  // Release unique email/username so a new user can be created with the same credentials later.
  const deletedSuffix = `${id.slice(0, 8)}_${Date.now()}`;
  const tombstoneEmail = `deleted+${deletedSuffix}@seeakk.local`;
  const tombstoneUsername = existing.username ? `deleted_${deletedSuffix}` : null;

  await (prisma as any).user.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      isActive: false,
      email: tombstoneEmail,
      username: tombstoneUsername,
    },
  });

  await invalidateUserSessions(id);

  logger.info('Admin soft-deleted user', { id, workspaceId, deletedBy: requestingUserId });

  return { message: 'User deleted successfully.' };
};

/**
 * Activate or deactivate a user.
 * Deactivation invalidates all active sessions.
 */
export const updateUserStatus = async (
  id: string,
  input: UpdateStatusInput,
  workspaceId: string,
  requestingUserId: string,
) => {
  if (id === requestingUserId && !input.isActive) {
    const err: any = new Error('Admins cannot deactivate their own account.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await (prisma as any).user.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) {
    const err: any = new Error('User not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  const user = await (prisma as any).user.update({
    where: { id },
    data: { isActive: input.isActive },
    select: { id: true, name: true, email: true, isActive: true, updatedAt: true },
  });

  if (!input.isActive) {
    await invalidateUserSessions(id);
    logger.info('Admin deactivated user — sessions invalidated', { id, workspaceId });
  } else {
    logger.info('Admin activated user', { id, workspaceId });
  }

  return user;
};

/**
 * Admin-initiated password reset.
 * Accepts an optional newPassword; auto-generates a secure one if omitted.
 * Invalidates all existing sessions after reset, forcing re-login.
 */
export const resetUserPassword = async (
  id: string,
  input: ResetPasswordInput,
  workspaceId: string,
) => {
  const existing = await (prisma as any).user.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!existing) {
    const err: any = new Error('User not found in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  if (input.newPassword) {
    const hashedPassword = await bcrypt.hash(input.newPassword, 12);

    await (prisma as any).user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    await invalidateUserSessions(id);
    logger.info('Admin reset user password directly', { id, workspaceId });
    return {
      message: 'Password reset successfully. User must log in again with the new password.',
    };
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    const err: any = new Error('JWT_SECRET is missing. Cannot generate reset token.');
    err.statusCode = 500;
    throw err;
  }

  const token = jwt.sign({ userId: existing.id, purpose: 'password_reset' }, jwtSecret, { expiresIn: '30m' });
  await sendPasswordResetEmail(existing.email, existing.name, token);

  logger.info('Admin requested password reset link', { id, email: existing.email, workspaceId });
  return {
    message: 'Password reset link sent to user email.',
  };
};
