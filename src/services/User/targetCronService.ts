import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { recordDailyViolation, recordMonthlyViolation } from './targetEvaluationService';

type CronTargetSetting = {
  userId: string;
  workspaceId: string;
  dailyFollowupTarget: number;
  monthlyTargetLeads: number;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
};

/**
 * Daily evaluation job.
 * Runs every midnight to check if users met their daily follow-up targets for the previous day.
 */
export const runDailyEvaluationJob = async () => {
  logger.info('Starting daily target evaluation job...');
  
  const evaluationDate = new Date();
  evaluationDate.setDate(evaluationDate.getDate() - 1);
  evaluationDate.setHours(0, 0, 0, 0);

  try {
    // 1. Get all active target settings
    // Note: In a real system, you would join this with actual "Leads" or "Followups" tables
    // For now, we fetch targets and assume evaluation logic would happen here.
    const activeTargets: CronTargetSetting[] = await (prisma as any).targetSetting.findMany({
      select: {
        userId: true,
        workspaceId: true,
        dailyFollowupTarget: true,
        monthlyTargetLeads: true
      },
      where: {
        startDate: { lte: evaluationDate },
        OR: [{ endDate: null }, { endDate: { gte: evaluationDate } }]
      }
    });

    for (const target of activeTargets) {
      // TODO: Fetch actual follow-up count for user from Lead/Activity table
      // const actualFollowups = await activityService.getFollowupCount(target.userId, evaluationDate);
      const actualFollowups = 0; // Mocked: assume 0 if no data
      
      if (actualFollowups < target.dailyFollowupTarget) {
        await recordDailyViolation(target.userId, target.workspaceId, evaluationDate);
      }
    }
    
    logger.info('Daily target evaluation job completed.');
  } catch (error: unknown) {
    logger.error('Daily evaluation job error', { error: getErrorMessage(error) });
  }
};

/**
 * Monthly evaluation job.
 * Runs on the 1st of every month to check performance for the previous month.
 */
export const runMonthlyEvaluationJob = async () => {
  logger.info('Starting monthly target evaluation job...');
  
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setMonth(monthStart.getMonth() - 1);
  monthStart.setHours(0, 0, 0, 0);

  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  monthEnd.setDate(0);
  monthEnd.setHours(23, 59, 59, 999);

  try {
    const activeTargets: CronTargetSetting[] = await (prisma as any).targetSetting.findMany({
      select: {
        userId: true,
        workspaceId: true,
        dailyFollowupTarget: true,
        monthlyTargetLeads: true
      },
      where: {
        cycle: 'MONTHLY',
        startDate: { lte: monthEnd },
        OR: [{ endDate: null }, { endDate: { gte: monthStart } }]
      }
    });

    for (const target of activeTargets) {
      // TODO: Fetch actual monthly leads generated
      // const actualLeads = await leadService.getMonthlyLeadCount(target.userId, monthStart, monthEnd);
      const actualLeads = 0; 

      if (actualLeads < target.monthlyTargetLeads) {
        await recordMonthlyViolation(target.userId, target.workspaceId, monthStart);
      }
    }
    
    logger.info('Monthly target evaluation job completed.');
  } catch (error: unknown) {
    logger.error('Monthly evaluation job error', { error: getErrorMessage(error) });
  }
};
