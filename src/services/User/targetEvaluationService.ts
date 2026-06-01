import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { lockUser } from './accountLockService';
import { isUserActingAsSupervisorOrStakeholder } from '../../modules/targets/targetLockEvaluation.service';

/**
 * Record a daily follow-up violation.
 * Logic:
 * 1st -> Warning
 * 2nd -> Final Warning
 * 3rd -> Lock Account
 */
export const recordDailyViolation = async (userId: string, workspaceId: string, date: Date) => {
  // Exclude supervisor/stakeholder accounts from daily target evaluations and locks completely.
  if (await isUserActingAsSupervisorOrStakeholder(userId)) {
    logger.info('Daily violation skipped: user is a supervisor/stakeholder', { userId });
    return;
  }

  const existingViolation = await (prisma as any).targetViolation.findFirst({
    where: { userId, type: 'DAILY', status: { in: ['WARNING', 'FINAL_WARNING'] } },
    orderBy: { createdAt: 'desc' }
  });

  let nextAttempt = 1;
  let status = 'WARNING';
  let message = 'Daily follow-up target not met: 1st warning.';

  if (existingViolation) {
    nextAttempt = existingViolation.attemptCount + 1;
    if (nextAttempt === 2) {
      status = 'FINAL_WARNING';
      message = 'Daily follow-up target not met: Final warning before lock.';
    } else if (nextAttempt >= 3) {
      status = 'LOCKED';
      message = 'Account locked due to 3 consecutive daily follow-up failures.';
      const isAssignedTargetOwner = await (prisma as any).targetAssignment.findFirst({
        where: { userId, workspaceId, isActive: true },
        select: { id: true },
      });
      if (isAssignedTargetOwner) {
        await lockUser(userId, workspaceId, message);
      }
    }
  }

  await (prisma as any).targetViolation.create({
    data: {
      userId,
      workspaceId,
      date,
      type: 'DAILY',
      attemptCount: nextAttempt,
      status,
      message
    }
  });

  logger.warn('Daily target violation recorded', { userId, status, nextAttempt });
};

/**
 * Record a monthly target violation.
 * Logic: Immediate Lock.
 */
export const recordMonthlyViolation = async (userId: string, workspaceId: string, date: Date) => {
  // Exclude supervisor/stakeholder accounts from monthly target evaluations and locks completely.
  if (await isUserActingAsSupervisorOrStakeholder(userId)) {
    logger.info('Monthly violation skipped: user is a supervisor/stakeholder', { userId });
    return;
  }

  const message = 'Account locked: Monthly critical KPI (Leads/Revenue) not met.';
  
  await (prisma as any).targetViolation.create({
    data: {
      userId,
      workspaceId,
      date,
      type: 'MONTHLY',
      attemptCount: 1,
      status: 'LOCKED',
      message
    }
  });

  const isAssignedTargetOwner = await (prisma as any).targetAssignment.findFirst({
    where: { userId, workspaceId, isActive: true },
    select: { id: true },
  });
  if (isAssignedTargetOwner) {
    await lockUser(userId, workspaceId, message);
    logger.error('Monthly critical KPI violation: Account Locked', { userId });
  }
};
