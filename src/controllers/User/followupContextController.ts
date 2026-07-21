import { Request, Response, NextFunction } from 'express';
import * as followupContextService from '../../services/User/followupContextService';
import logger from '../../utils/logger';

export const getLeadFollowupContext = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const { leadId } = req.params;
    let rawWorkspaceId = req.user!.workspaceId;
    if (Array.isArray(rawWorkspaceId)) rawWorkspaceId = rawWorkspaceId[0];
    const workspaceId: string = rawWorkspaceId as string;

    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }

    const data = await followupContextService.getLeadFollowupContext(leadId as string, workspaceId);

    res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    logger.error(`[getLeadFollowupContext] Error: ${error.message}`);
    next(error);
  }
};
