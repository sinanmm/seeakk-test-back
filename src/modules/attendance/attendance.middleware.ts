import { Request, Response, NextFunction } from 'express';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import logger from '../../utils/logger';

export type AttendanceRequest = Request & {
  attendanceWorkspaceId?: string;
};

/**
 * Resolves workspace for attendance APIs (owners may have workspace via ownerId, not user.workspaceId).
 */
export const resolveAttendanceWorkspace = async (
  req: AttendanceRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  if (!req.user.isOnboarded) {
    return res.status(403).json({
      success: false,
      errorCode: 'ONBOARDING_REQUIRED',
      message: 'Complete workspace onboarding before marking attendance.',
    });
  }

  try {
    const workspaceId = await resolveWorkspaceIdForUser(
      req.user.id,
      (req.user as { workspaceId?: string | null }).workspaceId ?? null,
    );

    if (!workspaceId) {
      return res.status(403).json({
        success: false,
        errorCode: 'WORKSPACE_NOT_LINKED',
        message: 'Forbidden: No workspace linked to your account.',
      });
    }

    req.attendanceWorkspaceId = workspaceId;
    return next();
  } catch (error: any) {
    logger.error('Failed to resolve attendance workspace', {
      userId: req.user.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to resolve workspace for attendance.',
    });
  }
};
