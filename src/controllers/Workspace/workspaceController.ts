import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { seedDefaultMasterData } from '../../services/Seeding/seedingService';

const SUPERADMIN_ROLE_NAME = 'superadmin';
const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

const ensureWorkspaceOwnerRole = async (workspaceId: string) => {
  const superAdminRole = await prisma.role.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: SUPERADMIN_ROLE_NAME,
      },
    },
    update: {
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
    create: {
      workspaceId,
      name: SUPERADMIN_ROLE_NAME,
      description: 'Workspace Owner with full system access',
      status: 'ACTIVE',
      isSystemRole: true,
    },
  });

  const permissions = await prisma.permission.findMany({
    select: { id: true },
  });

  if (permissions.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: superAdminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  return superAdminRole;
};

export const setupWorkspace = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const { companyName, employeeCount, timeZone, language, currencyLocale, loadSampleData, logoUrl } = req.body;

    if (user.isOnboarded) {
      return res.status(400).json({ message: 'Workspace is already set up for this user.' });
    }

    if (!companyName || !employeeCount) {
      return res.status(400).json({ message: 'Company Name and Employee Count are required.' });
    }

    const normalizedLogoUrl = typeof logoUrl === 'string' ? logoUrl.trim() : '';
    if (normalizedLogoUrl) {
      const isImageDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(normalizedLogoUrl);
      if (!isImageDataUrl || normalizedLogoUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
        return res.status(400).json({ message: 'Invalid company logo. Please upload a smaller valid image.' });
      }
    }

    // 1. Create the workspace and link to the owner simultaneously
    let newWorkspace;
    try {
      newWorkspace = await prisma.workspace.create({
        data: {
          companyName,
          logoUrl: normalizedLogoUrl || null,
          employeeCount,
          timeZone: timeZone || 'UTC',
          language: language || 'en-US',
          currencyLocale: currencyLocale || 'USD',
          loadSampleData: loadSampleData || false,
          ownerId: user.id,
        },
      });
    } catch (error: any) {
      // Backward-compatible fallback when server code is newer than production DB migration state.
      const missingLogoColumn =
        (error?.code === 'P2022' &&
          typeof error?.meta?.column === 'string' &&
          error.meta.column.includes('logoUrl')) ||
        (typeof error?.message === 'string' &&
          (error.message.includes('workspaces.logoUrl') || error.message.includes('logoUrl')));

      if (missingLogoColumn) {
        newWorkspace = await prisma.workspace.create({
          data: {
            companyName,
            employeeCount,
            timeZone: timeZone || 'UTC',
            language: language || 'en-US',
            currencyLocale: currencyLocale || 'USD',
            loadSampleData: loadSampleData || false,
            ownerId: user.id,
          },
        });
      } else {
        throw error;
      }
    }

    // 2. Ensure the workspace owner gets the workspace-scoped superadmin role.
    const superAdminRole = await ensureWorkspaceOwnerRole(newWorkspace.id);

    // 3. Update user: assign superadmin role, mark as onboarded, link workspace
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        roleId: superAdminRole.id,
        isOnboarded: true,
        workspaceId: newWorkspace.id,
      },
      include: { role: true },
    });

    const rolePermissions = await prisma.rolePermission.findMany({
      where: { roleId: superAdminRole.id },
      include: {
        permission: {
          select: { key: true },
        },
      },
    });
    const permissionKeys = rolePermissions
      .map((rolePermission) => rolePermission.permission?.key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);

    // 4. Seed default master data for the new workspace
    await seedDefaultMasterData(newWorkspace.id, user.id);

    logger.info('Workspace successfully configured', {
      workspaceId: newWorkspace.id,
      userId: user.id,
      action: 'workspace_setup',
    });

    return res.status(201).json({
      message: 'Workspace successfully configured!',
      workspace: newWorkspace,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        permissions: permissionKeys,
        isOnboarded: updatedUser.isOnboarded,
        workspaceId: updatedUser.workspaceId,
      },
    });
  } catch (error) {
    next(error);
  }
};
