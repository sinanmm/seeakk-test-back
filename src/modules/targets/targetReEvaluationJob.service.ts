import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import { lockUser } from '../../services/User/accountLockService';
import { evaluateAssignmentPeriod, TARGET_LOCK_REASON_CODE } from './targetPerformance.service';

const db = prisma as any;

/**
 * Validates whether a supervisor is eligible to be locked according to enterprise safeguards.
 */
export const checkSupervisorLockEligibility = async (
  supervisorId: string,
  workspaceId: string,
  visitedUserIds: Set<string>,
): Promise<{ eligible: boolean; reason?: string; supervisor?: any }> => {
  if (!supervisorId) {
    return { eligible: false, reason: 'NO_SUPERVISOR' };
  }

  if (visitedUserIds.has(supervisorId)) {
    return { eligible: false, reason: 'CIRCULAR_HIERARCHY_DETECTED' };
  }

  const supervisor = await db.user.findFirst({
    where: { id: supervisorId, workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      isLocked: true,
      isActive: true,
      workspaceId: true,
      supervisorId: true,
      role: { select: { name: true } },
    },
  });

  if (!supervisor) {
    return { eligible: false, reason: 'SUPERVISOR_NOT_FOUND' };
  }

  if (!supervisor.isActive) {
    return { eligible: false, reason: 'SUPERVISOR_INACTIVE', supervisor };
  }

  // Superadmins are root and protected from automated target locks
  if (supervisor.role?.name?.toUpperCase() === 'SUPERADMIN') {
    return { eligible: false, reason: 'SUPERVISOR_IS_SUPERADMIN', supervisor };
  }

  // Safeguard: Supervisor cannot be self-referential
  if (supervisor.supervisorId === supervisor.id) {
    return { eligible: false, reason: 'SUPERVISOR_SELF_REFERENTIAL', supervisor };
  }

  // Safeguard: Specific requirement - Only lock the supervisor when the supervisor has another valid, separate supervisor above them.
  if (!supervisor.supervisorId) {
    return { eligible: false, reason: 'SUPERVISOR_HAS_NO_HIGHER_SUPERVISOR', supervisor };
  }

  const higherSupervisor = await db.user.findFirst({
    where: { id: supervisor.supervisorId, workspaceId, deletedAt: null },
    select: { id: true, isActive: true, supervisorId: true },
  });

  if (!higherSupervisor || !higherSupervisor.isActive) {
    return { eligible: false, reason: 'SUPERVISOR_HIGHER_SUPERVISOR_INVALID', supervisor };
  }

  if (higherSupervisor.id === supervisor.id) {
    return { eligible: false, reason: 'SUPERVISOR_HIGHER_SUPERVISOR_SELF_REFERENTIAL', supervisor };
  }

  return { eligible: true, supervisor };
};

/**
 * Executes dynamic, safeguard-protected supervisor lock escalation.
 */
export const executeSupervisorLockEscalation = async (
  workspaceId: string,
  originatingUser: { id: string; name: string },
  originatingLockLogId: string,
  targetCyclePeriodId: string,
  enableChainLocking: boolean,
  tx?: any,
): Promise<Array<{ supervisorId: string; escalationLevel: number; lockLogId: string }>> => {
  const prismaClient = tx || db;
  const lockedSupervisors: Array<{ supervisorId: string; escalationLevel: number; lockLogId: string }> = [];
  const visitedUserIds = new Set<string>([originatingUser.id]);

  // Fetch initial user supervisor
  const user = await prismaClient.user.findUnique({
    where: { id: originatingUser.id },
    select: { supervisorId: true },
  });

  let currentSupervisorId = user?.supervisorId;
  let escalationLevel = 1;
  const MAX_SAFE_DEPTH = 10;

  while (currentSupervisorId && escalationLevel <= MAX_SAFE_DEPTH) {
    // Check self-referential check against originating user
    if (currentSupervisorId === originatingUser.id) {
      logger.info('Supervisor escalation stopped: supervisor is originating user self', {
        originatingUserId: originatingUser.id,
        currentSupervisorId,
      });
      break;
    }

    const eligibility = await checkSupervisorLockEligibility(currentSupervisorId, workspaceId, visitedUserIds);
    visitedUserIds.add(currentSupervisorId);

    if (!eligibility.eligible) {
      logger.info('Supervisor lock skipped due to safeguard', {
        supervisorId: currentSupervisorId,
        originatingUserId: originatingUser.id,
        reason: eligibility.reason,
        escalationLevel,
      });
      break;
    }

    const supervisor = eligibility.supervisor;

    // Build escalation lock reason
    const lockReason =
      escalationLevel === 1
        ? `${TARGET_LOCK_REASON_CODE}: Supervisor accountability lock triggered because assigned user "${originatingUser.name}" failed to complete target after self-unlock grace period.`
        : `${TARGET_LOCK_REASON_CODE}: Supervisor accountability escalation (Level ${escalationLevel}) triggered by unresolved target failure of "${originatingUser.name}" in reporting chain.`;

    // Apply lock
    await lockUser(supervisor.id, workspaceId, lockReason);

    await prismaClient.user.update({
      where: { id: supervisor.id },
      data: {
        isLocked: true,
        targetLockedAt: new Date(),
        targetLockReason: lockReason,
      },
    });

    const lockLog = await prismaClient.targetLockLog.create({
      data: {
        userId: supervisor.id,
        workspaceId,
        assignmentId: null,
        periodId: targetCyclePeriodId,
        lockPeriodId: targetCyclePeriodId,
        reason: lockReason,
        lockedBySystem: true,
        isInvalidLock: false,
        escalationLevel,
        originatingUserId: originatingUser.id,
        originatingLockId: originatingLockLogId,
      },
    });

    lockedSupervisors.push({
      supervisorId: supervisor.id,
      escalationLevel,
      lockLogId: lockLog.id,
    });

    logger.warn('Supervisor locked via target escalation', {
      supervisorId: supervisor.id,
      originatingUserId: originatingUser.id,
      escalationLevel,
      lockLogId: lockLog.id,
    });

    // If chain locking is disabled, stop after immediate supervisor
    if (!enableChainLocking) {
      break;
    }

    // Move to next supervisor up the chain
    currentSupervisorId = supervisor.supervisorId;
    escalationLevel += 1;
  }

  return lockedSupervisors;
};

/**
 * Automated job to process expired self-unlock grace periods across workspace assignments.
 */
export const processDueTargetReEvaluations = async (workspaceId?: string) => {
  const now = new Date();

  const dueLockLogs = await db.targetLockLog.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      selfUnlockUsed: true,
      reEvaluatedAt: null,
      isInvalidLock: false,
      reEvaluationAt: { lte: now },
    },
    include: {
      user: { select: { id: true, name: true, workspaceId: true, isLocked: true } },
    },
  });

  if (!dueLockLogs.length) {
    return { processed: 0, passed: 0, failed: 0 };
  }

  let passedCount = 0;
  let failedCount = 0;

  for (const lockLog of dueLockLogs) {
    const userWorkspaceId = lockLog.workspaceId || lockLog.user.workspaceId;
    const periodId = lockLog.lockPeriodId || lockLog.periodId;

    if (!periodId) {
      await db.targetLockLog.update({
        where: { id: lockLog.id },
        data: { reEvaluatedAt: now, reEvaluationPassed: false },
      });
      continue;
    }

    const assignment = await db.targetAssignment.findFirst({
      where: { userId: lockLog.userId, workspaceId: userWorkspaceId, isActive: true },
      include: { targetCycle: true },
    });

    if (!assignment) {
      await db.targetLockLog.update({
        where: { id: lockLog.id },
        data: { reEvaluatedAt: now, reEvaluationPassed: false },
      });
      continue;
    }

    const period = await db.targetCyclePeriod.findUnique({
      where: { id: periodId },
      include: { metrics: true },
    });

    if (!period) {
      await db.targetLockLog.update({
        where: { id: lockLog.id },
        data: { reEvaluatedAt: now, reEvaluationPassed: false },
      });
      continue;
    }

    // Evaluate target performance using core evaluation engine
    const evaluationResult = await evaluateAssignmentPeriod(assignment.id, period.id);
    const targetMet = Boolean(evaluationResult?.completed);

    if (targetMet) {
      // User passed re-evaluation!
      await db.targetLockLog.update({
        where: { id: lockLog.id },
        data: {
          reEvaluatedAt: now,
          reEvaluationPassed: true,
        },
      });

      await auditService.log({
        userId: lockLog.userId,
        workspaceId: userWorkspaceId,
        action: 'TARGET_GRACE_REEVALUATION_PASSED',
        entityType: 'User',
        entityId: lockLog.userId,
        details: { lockLogId: lockLog.id, periodId },
      });

      passedCount += 1;
    } else {
      // User failed re-evaluation at grace expiry!
      failedCount += 1;
      const graceDays = lockLog.selfUnlockGraceDays || period.selfUnlockGraceDays || 1;
      const reLockReason = `Target not completed within the ${graceDays}-day self-unlock grace period.`;
      const standardizedReason = `${TARGET_LOCK_REASON_CODE}: ${reLockReason}`;

      await db.$transaction(async (tx: any) => {
        // Mark previous lock log re-evaluated
        await tx.targetLockLog.update({
          where: { id: lockLog.id },
          data: {
            reEvaluatedAt: now,
            reEvaluationPassed: false,
          },
        });

        // Lock user again
        await lockUser(lockLog.userId, userWorkspaceId, standardizedReason);

        await tx.user.update({
          where: { id: lockLog.userId },
          data: {
            isLocked: true,
            targetLockedAt: now,
            targetLockReason: standardizedReason,
          },
        });

        // Create new lock log
        const newLockLog = await tx.targetLockLog.create({
          data: {
            userId: lockLog.userId,
            workspaceId: userWorkspaceId,
            assignmentId: assignment.id,
            periodId,
            lockPeriodId: periodId,
            reason: standardizedReason,
            lockedBySystem: true,
            isInvalidLock: false,
            selfUnlockAllowed: false, // Self unlock disabled for re-failed lock cycle
            selfUnlockUsed: true,
            originalLockId: lockLog.id,
            reLockCount: (lockLog.reLockCount || 0) + 1,
            lockSupervisorOnRefailure: period.lockSupervisorOnRefailure,
            enableSupervisorLockChain: period.enableSupervisorLockChain,
          },
        });

        // Evaluate supervisor locking if configured
        if (period.lockSupervisorOnRefailure) {
          await executeSupervisorLockEscalation(
            userWorkspaceId,
            { id: lockLog.userId, name: lockLog.user.name || 'Staff' },
            newLockLog.id,
            periodId,
            period.enableSupervisorLockChain,
            tx,
          );
        }
      });

      await auditService.log({
        userId: lockLog.userId,
        workspaceId: userWorkspaceId,
        action: 'TARGET_GRACE_REEVALUATION_FAILED',
        entityType: 'User',
        entityId: lockLog.userId,
        details: {
          lockLogId: lockLog.id,
          periodId,
          lockSupervisorOnRefailure: period.lockSupervisorOnRefailure,
          enableSupervisorLockChain: period.enableSupervisorLockChain,
        },
      });
    }
  }

  return { processed: dueLockLogs.length, passed: passedCount, failed: failedCount };
};
