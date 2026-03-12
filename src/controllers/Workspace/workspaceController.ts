import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const setupWorkspace = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const { companyName, employeeCount, timeZone, language, currencyLocale, loadSampleData } = req.body;

    if (user.isOnboarded) {
      return res.status(400).json({ message: 'Workspace is already set up for this user.' });
    }

    if (!companyName || !employeeCount) {
      return res.status(400).json({ message: 'Company Name and Employee Count are required.' });
    }

    // 1. Find or create the admin role
    let adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: { name: 'admin', description: 'Super Administrator' },
      });
    }

    // 2. Create the workspace and link to the owner simultaneously
    const newWorkspace = await prisma.workspace.create({
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

    // 3. Update user: assign admin role, mark as onboarded, link workspace
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        roleId: adminRole.id,
        isOnboarded: true,
        workspaceId: newWorkspace.id,
      },
      include: { role: true },
    });

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
        isOnboarded: updatedUser.isOnboarded,
        workspaceId: updatedUser.workspaceId,
      },
    });
  } catch (error) {
    next(error);
  }
};
