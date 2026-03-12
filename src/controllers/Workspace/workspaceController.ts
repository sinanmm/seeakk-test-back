import { Request, Response, NextFunction } from 'express';
import Workspace from '../../models/Workspace/workspace';
import User, { IUser } from '../../models/Auth/user';
import Role from '../../models/Auth/role';
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

    const newWorkspace = await Workspace.create({
      companyName,
      employeeCount,
      timeZone: timeZone || 'UTC',
      language: language || 'en-US',
      currencyLocale: currencyLocale || 'USD',
      loadSampleData: loadSampleData || false,
      owner: user._id,
    });

    let adminRole = await Role.findOne({ name: 'admin' });
    if (!adminRole) {
      adminRole = await Role.create({ name: 'admin', description: 'Super Administrator' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        workspace: newWorkspace._id,
        isOnboarded: true,
        role: adminRole._id,
      },
      { new: true }
    ).populate('role') as IUser;

    logger.info('Workspace successfully configured', {
      workspaceId: newWorkspace._id,
      userId: user._id,
      action: 'workspace_setup',
    });

    return res.status(201).json({
      message: 'Workspace successfully configured!',
      workspace: newWorkspace,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isOnboarded: updatedUser.isOnboarded,
        workspaceId: updatedUser.workspace,
      },
    });
  } catch (error) {
    next(error);
  }
};
