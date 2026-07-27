import { Request, Response, NextFunction } from 'express';
import prisma, { directPrisma } from '../../config/prisma';
import logger from '../../utils/logger';
import { seedDefaultMasterData } from '../../services/Seeding/seedingService';

const SUPERADMIN_ROLE_NAME = 'superadmin';
const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

const normalizeWorkspaceBrandingInput = (input: { companyName?: unknown; logoUrl?: unknown }) => {
  const normalizedCompanyName = typeof input.companyName === 'string' ? input.companyName.trim() : '';
  const normalizedLogoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';

  if (!normalizedCompanyName) {
    return { error: 'Company name is required.' };
  }

  if (normalizedLogoUrl) {
    const isImageDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(normalizedLogoUrl);
    if (!isImageDataUrl || normalizedLogoUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
      return { error: 'Invalid company logo. Please upload a smaller valid image.' };
    }
  }

  return {
    companyName: normalizedCompanyName,
    logoUrl: normalizedLogoUrl || null,
  };
};

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

    const branding = normalizeWorkspaceBrandingInput({ companyName, logoUrl });
    if ('error' in branding) {
      return res.status(400).json({ message: branding.error });
    }

    // 1. Create the workspace and link to the owner simultaneously
    let newWorkspace;
    try {
      newWorkspace = await directPrisma.workspace.create({
        data: {
          companyName: branding.companyName,
          logoUrl: branding.logoUrl,
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
        newWorkspace = await directPrisma.workspace.create({
          data: {
            companyName: branding.companyName,
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
  } catch (error: any) {
    logger.error('Workspace setup failed', {
      action: 'workspace_setup_error',
      incomingRequestBody: req.body,
      validatedPayload: {
        companyName: req.body.companyName,
        employeeCount: req.body.employeeCount,
        timeZone: req.body.timeZone,
        language: req.body.language,
        currencyLocale: req.body.currencyLocale,
        loadSampleData: req.body.loadSampleData,
        logoUrlLength: req.body.logoUrl ? req.body.logoUrl.length : 0,
      },
      prismaDataObject: {
        companyName: req.body.companyName,
        employeeCount: req.body.employeeCount,
        timeZone: req.body.timeZone || 'UTC',
        language: req.body.language || 'en-US',
        currencyLocale: req.body.currencyLocale || 'USD',
        loadSampleData: req.body.loadSampleData || false,
        ownerId: req.user?.id,
        logoUrlLength: req.body.logoUrl ? req.body.logoUrl.length : 0,
      },
      fullPrismaError: error,
      completePostgresError: error.meta ?? error.message,
    });
    next(error);
  }
};

export const updateWorkspaceProfile = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    if (!req.user?.workspaceId) {
      return res.status(404).json({ message: 'Workspace not found for this user.' });
    }

    const existingWorkspace = await directPrisma.workspace.findUnique({
      where: { id: req.user.workspaceId },
    });

    if (!existingWorkspace) {
      return res.status(404).json({ message: 'Workspace not found.' });
    }

    const updateData: any = {};
    const { companyName, logoUrl, employeeCount, timeZone, language, currencyLocale } = req.body ?? {};

    if (companyName !== undefined) {
      const branding = normalizeWorkspaceBrandingInput({ companyName, logoUrl: logoUrl ?? existingWorkspace.logoUrl });
      if ('error' in branding) {
        return res.status(400).json({ message: branding.error });
      }
      updateData.companyName = branding.companyName;
    }

    if (logoUrl !== undefined) {
      const branding = normalizeWorkspaceBrandingInput({ companyName: companyName ?? existingWorkspace.companyName, logoUrl });
      if ('error' in branding) {
        return res.status(400).json({ message: branding.error });
      }
      updateData.logoUrl = branding.logoUrl;
    }

    if (employeeCount !== undefined) {
      updateData.employeeCount = typeof employeeCount === 'string' ? employeeCount.trim() : String(employeeCount);
    }

    if (timeZone !== undefined) {
      updateData.timeZone = typeof timeZone === 'string' ? timeZone.trim() : 'UTC';
    }

    if (language !== undefined) {
      updateData.language = typeof language === 'string' ? language.trim() : 'en-US';
    }

    if (currencyLocale !== undefined) {
      updateData.currencyLocale = typeof currencyLocale === 'string' ? currencyLocale.trim() : 'USD';
    }

    const workspace = await directPrisma.workspace.update({
      where: { id: req.user.workspaceId },
      data: updateData,
      select: {
        id: true,
        companyName: true,
        logoUrl: true,
        employeeCount: true,
        timeZone: true,
        language: true,
        currencyLocale: true,
        loadSampleData: true,
      },
    });

    logger.info('Workspace settings updated', {
      workspaceId: workspace.id,
      userId: req.user.id,
      changedFields: Object.keys(updateData),
      action: 'workspace_settings_updated',
    });

    return res.status(200).json({
      success: true,
      message: 'Workspace settings updated successfully.',
      workspace,
    });
  } catch (error) {
    next(error);
  }
};
