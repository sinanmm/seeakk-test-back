import prisma from '../../config/prisma';

const INVITE_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  isActive: true,
  isEmailVerified: true,
  isOnboarded: true,
  workspaceId: true,
  role: { select: { id: true, name: true } },
  workspace: { select: { id: true, companyName: true } },
} as const;

export type InviteUserRecord = Awaited<ReturnType<typeof findUserById>>;

export const findUserByEmail = (email: string) =>
  (prisma as any).user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
    },
    select: {
      id: true,
      email: true,
      deletedAt: true,
      workspaceId: true,
    },
  });

export const findUserByUsername = (username: string) =>
  (prisma as any).user.findUnique({
    where: { username },
    select: { id: true },
  });

export const findRoleByIdOrName = (value: string, workspaceId: string) =>
  prisma.role.findFirst({
    where: {
      workspaceId,
      OR: [
        { id: value },
        { name: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
  });

export const findDepartmentByIdOrName = (value: string, workspaceId: string) =>
  (prisma as any).department.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { id: value },
        { name: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
  });

export const findOfficeById = (officeId: string, workspaceId: string) =>
  (prisma as any).office.findFirst({
    where: { id: officeId, workspaceId, isActive: true },
    select: { id: true, name: true },
  });

export const findSupervisorById = (supervisorId: string, workspaceId: string) =>
  prisma.user.findFirst({
    where: { id: supervisorId, workspaceId } as any,
    select: { id: true, name: true, email: true },
  });

export const findWorkspaceById = (workspaceId: string) =>
  prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, companyName: true },
  });

export const findUserById = (userId: string) =>
  (prisma as any).user.findUnique({
    where: { id: userId },
    select: INVITE_USER_SELECT,
  });

export const createInvitedUserWithInvite = async (input: {
  workspaceId: string;
  createdBy: string;
  tokenHash: string;
  expiresAt: Date;
  userData: {
    name: string;
    username?: string | null;
    email: string;
    phone?: string | null;
    roleId?: string | null;
    departmentId?: string | null;
    supervisorId?: string | null;
    officeId?: string | null;
    countryId?: string | null;
    stateId?: string | null;
    districtId?: string | null;
    assignedLocationIds?: string[];
  };
  restoreUserId?: string | null;
}) => {
  return prisma.$transaction(async (tx: any) => {
    let user;

    const baseData = {
      name: input.userData.name,
      username: input.userData.username ?? null,
      email: input.userData.email,
      password: null,
      phone: input.userData.phone ?? null,
      isEmailVerified: false,
      isActive: false,
      isOnboarded: true,
      workspaceId: input.workspaceId,
      roleId: input.userData.roleId ?? null,
      departmentId: input.userData.departmentId ?? null,
      supervisorId: input.userData.supervisorId ?? null,
      officeId: input.userData.officeId ?? null,
      countryId: input.userData.countryId ?? null,
      stateId: input.userData.stateId ?? null,
      districtId: input.userData.districtId ?? null,
      deletedAt: null,
      invitationToken: null,
      invitationExpires: null,
      verificationToken: null,
      verificationTokenExpires: null,
    };

    if (input.restoreUserId) {
      await tx.userLocationAssignment.deleteMany({
        where: { userId: input.restoreUserId },
      });

      await tx.invite.updateMany({
        where: {
          userId: input.restoreUserId,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });

      user = await tx.user.update({
        where: { id: input.restoreUserId },
        data: {
          ...baseData,
          assignedLocations:
            input.userData.assignedLocationIds && input.userData.assignedLocationIds.length > 0
              ? {
                  create: input.userData.assignedLocationIds.map((locationId) => ({
                    locationId,
                    workspaceId: input.workspaceId,
                  })),
                }
              : undefined,
        },
        select: INVITE_USER_SELECT,
      });
    } else {
      user = await tx.user.create({
        data: {
          ...baseData,
          assignedLocations:
            input.userData.assignedLocationIds && input.userData.assignedLocationIds.length > 0
              ? {
                  create: input.userData.assignedLocationIds.map((locationId) => ({
                    locationId,
                    workspaceId: input.workspaceId,
                  })),
                }
              : undefined,
        },
        select: INVITE_USER_SELECT,
      });
    }

    await tx.invite.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    const invite = await tx.invite.create({
      data: {
        userId: user.id,
        workspaceId: input.workspaceId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
      },
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return { user, invite };
  });
};

export const findInviteByTokenHash = (tokenHash: string) =>
  (prisma as any).invite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
      workspaceId: true,
      user: {
        select: INVITE_USER_SELECT,
      },
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

export const acceptInvite = async (input: {
  inviteId: string;
  userId: string;
  passwordHash: string;
  acceptedAt: Date;
}) => {
  return prisma.$transaction(async (tx: any) => {
    const marked = await tx.invite.updateMany({
      where: {
        id: input.inviteId,
        usedAt: null,
        expiresAt: { gt: input.acceptedAt },
      },
      data: { usedAt: input.acceptedAt },
    });

    if (marked.count !== 1) {
      return null;
    }

    const user = await tx.user.update({
      where: { id: input.userId },
      data: {
        password: input.passwordHash,
        isActive: true,
        isEmailVerified: true,
        isOnboarded: true,
        invitationToken: null,
        invitationExpires: null,
      },
      select: INVITE_USER_SELECT,
    });

    return user;
  });
};
