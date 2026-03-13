import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { recordDailyViolation, recordMonthlyViolation } from './targetEvaluationService';

/**
 * Daily evaluation job.
 * Runs every midnight to check if users met their daily follow-up targets for the previous day.
 */
export const runDailyEvaluationJob = async () => {
  logger.info('Starting daily target evaluation job...');
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  try {
    // 1. Get all active target settings
    // Note: In a real system, you would join this with actual "Leads" or "Followups" tables
    // For now, we fetch targets and assume evaluation logic would happen here.
    const activeTargets = await (prisma as any).targetSetting.findMany({
      where: {
        startDate: { lte: new Date() },
        OR: [{ endDate: null }, { endDate: { gte: new Date() } }]
      }
    });

    for (const target of activeTargets) {
      // TODO: Fetch actual follow-up count for user from Lead/Activity table
      // const actualFollowups = await activityService.getFollowupCount(target.userId, yesterday);
      const actualFollowups = 0; // Mocked: assume 0 if no data
      
      if (actualFollowups < target.dailyFollowupTarget) {
        await recordDailyViolation(target.userId, target.workspaceId, yesterday);
      }
    }
    
    logger.info('Daily target evaluation job completed.');
  } catch (error: any) {
    logger.error('Daily evaluation job error', { error: error.message });
  }
};

/**
 * Monthly evaluation job.
 * Runs on the 1st of every month to check performance for the previous month.
 */
export const runMonthlyEvaluationJob = async () => {
  logger.info('Starting monthly target evaluation job...');
  
  const firstOfCurrentMonth = new Date();
  firstOfCurrentMonth.setDate(1);
  firstOfCurrentMonth.setHours(0, 0, 0, 0);

  try {
    const activeTargets = await (prisma as any).targetSetting.findMany({
      where: { cycle: 'MONTHLY' }
    });

    for (const target of activeTargets) {
      // TODO: Fetch actual monthly leads generated
      // const actualLeads = await leadService.getMonthlyLeadCount(target.userId);
      const actualLeads = 0; 

      if (actualLeads < target.monthlyTargetLeads) {
        await recordMonthlyViolation(target.userId, target.workspaceId, firstOfCurrentMonth);
      }
    }
    
    logger.info('Monthly target evaluation job completed.');
  } catch (error: any) {
    logger.error('Monthly evaluation job error', { error: error.message });
  }
};
