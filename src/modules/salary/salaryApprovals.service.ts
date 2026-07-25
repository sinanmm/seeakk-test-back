import prisma from '../../config/prisma';
import {
  ProcessApprovalInput,
  EditSalaryBeforeApprovalInput,
} from './salary.types';
import { SalaryRecordStatus, SalaryApprovalAction } from '@prisma/client';
import { emitUserEvent } from '../../realtime/socket';

/**
 * List pending salary approvals for the logged-in approver user
 */
export const listPendingApprovals = async (
  query: { page?: number; limit?: number; month?: number; year?: number; search?: string },
  workspaceId: string,
  approverUserId: string,
  userPermissions: string[] = [],
  isSuperAdmin = false,
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  // Find all active stages in this workspace where current user is approver
  const userStages = await (prisma as any).salaryApprovalStage.findMany({
    where: { workspaceId, approverUserId, isActive: true },
    select: { order: true, name: true, designation: true },
  });

  const stageOrders = userStages.map((s: any) => s.order);

  // If user has explicit SALARY_APPROVALS_VIEW or is superadmin, but is not mapped to a stage order,
  // allow viewing all pending records if they hold admin level perms, or return records for their orders
  const canViewAllPending = isSuperAdmin || userPermissions.includes('SALARY_APPROVALS_APPROVE');

  let where: any = {
    workspaceId,
    status: SalaryRecordStatus.PENDING_APPROVAL,
  };

  if (!canViewAllPending || stageOrders.length > 0) {
    if (stageOrders.length === 0 && !isSuperAdmin) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }
    if (stageOrders.length > 0) {
      where.currentStageOrder = { in: stageOrders };
    }
  }

  if (query.month) where.month = Number(query.month);
  if (query.year) where.year = Number(query.year);

  if (query.search) {
    const term = query.search.trim();
    where.user = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { username: { contains: term, mode: 'insensitive' } },
      ],
    };
  }

  const [total, records] = await Promise.all([
    (prisma as any).salaryRecord.count({ where }),
    (prisma as any).salaryRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            profileImageUrl: true,
            department: { select: { id: true, name: true } },
            office: { select: { id: true, name: true } },
          },
        },
        generatedBy: { select: { id: true, name: true, email: true } },
        approvals: {
          orderBy: { createdAt: 'asc' },
          include: {
            approverUser: { select: { id: true, name: true, email: true } },
          },
        },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            editedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
  ]);

  return {
    data: records,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Process approval action: APPROVE, REJECT, or RETURN
 */
export const processApproval = async (
  salaryRecordId: string,
  input: ProcessApprovalInput,
  workspaceId: string,
  approverUserId: string,
) => {
  const record = await (prisma as any).salaryRecord.findFirst({
    where: { id: salaryRecordId, workspaceId },
  });

  if (!record) {
    const err: any = new Error('Salary record not found.');
    err.statusCode = 404;
    throw err;
  }

  if (record.status !== SalaryRecordStatus.PENDING_APPROVAL) {
    const err: any = new Error(`Salary record is not in PENDING_APPROVAL status (Current: ${record.status}).`);
    err.statusCode = 400;
    throw err;
  }

  // Fetch all active approval stages in workspace ordered by order
  const allStages = await (prisma as any).salaryApprovalStage.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { order: 'asc' },
  });

  const maxStageOrder = allStages.length > 0 ? Math.max(...allStages.map((s: any) => s.order)) : 1;
  const currentStage = allStages.find((s: any) => s.order === record.currentStageOrder);

  if (input.action === 'REJECT') {
    if (!input.remarks || !input.remarks.trim()) {
      const err: any = new Error('Remarks are mandatory when rejecting a salary record.');
      err.statusCode = 400;
      throw err;
    }

    const updated = await (prisma as any).salaryRecord.update({
      where: { id: salaryRecordId },
      data: {
        status: SalaryRecordStatus.REJECTED,
        remarks: input.remarks.trim(),
      },
    });

    await (prisma as any).salaryApproval.create({
      data: {
        salaryRecordId,
        stageOrder: record.currentStageOrder,
        approverUserId,
        action: SalaryApprovalAction.REJECTED,
        remarks: input.remarks.trim(),
      },
    });

    await (prisma as any).salaryHistory.create({
      data: {
        salaryRecordId,
        editedById: approverUserId,
        action: 'REJECTED',
        reason: input.remarks.trim(),
      },
    });

    // Notify generator
    emitUserEvent(record.generatedById, 'salary_rejected' as any, {
      salaryRecordId,
      month: record.month,
      year: record.year,
      remarks: input.remarks.trim(),
    });

    return updated;
  }

  if (input.action === 'RETURN') {
    const updated = await (prisma as any).salaryRecord.update({
      where: { id: salaryRecordId },
      data: {
        status: SalaryRecordStatus.RETURNED,
        remarks: input.remarks ? input.remarks.trim() : 'Returned for correction',
      },
    });

    await (prisma as any).salaryApproval.create({
      data: {
        salaryRecordId,
        stageOrder: record.currentStageOrder,
        approverUserId,
        action: SalaryApprovalAction.RETURNED,
        remarks: input.remarks ? input.remarks.trim() : undefined,
      },
    });

    await (prisma as any).salaryHistory.create({
      data: {
        salaryRecordId,
        editedById: approverUserId,
        action: 'RETURNED_FOR_CORRECTION',
        reason: input.remarks ? input.remarks.trim() : 'Returned for correction',
      },
    });

    emitUserEvent(record.generatedById, 'salary_returned' as any, {
      salaryRecordId,
      month: record.month,
      year: record.year,
      remarks: input.remarks ? input.remarks.trim() : '',
    });

    return updated;
  }

  // Action is APPROVE
  const isFinalStage = record.currentStageOrder >= maxStageOrder || allStages.length === 0;

  let updatedStatus = record.status;
  let nextStageOrder = record.currentStageOrder;

  if (isFinalStage) {
    updatedStatus = SalaryRecordStatus.APPROVED;
  } else {
    // Find next stage in sequence
    const nextStage = allStages.find((s: any) => s.order > record.currentStageOrder);
    nextStageOrder = nextStage ? nextStage.order : record.currentStageOrder + 1;
  }

  const updated = await (prisma as any).salaryRecord.update({
    where: { id: salaryRecordId },
    data: {
      status: updatedStatus,
      currentStageOrder: nextStageOrder,
      remarks: input.remarks ? input.remarks.trim() : record.remarks,
    },
  });

  await (prisma as any).salaryApproval.create({
    data: {
      salaryRecordId,
      stageOrder: record.currentStageOrder,
      approverUserId,
      action: SalaryApprovalAction.APPROVED,
      remarks: input.remarks ? input.remarks.trim() : undefined,
    },
  });

  await (prisma as any).salaryHistory.create({
    data: {
      salaryRecordId,
      editedById: approverUserId,
      action: isFinalStage ? 'FINAL_APPROVED' : `STAGE_${record.currentStageOrder}_APPROVED`,
      reason: input.remarks ? input.remarks.trim() : 'Approved',
    },
  });

  if (!isFinalStage) {
    // Notify next stage approver
    const nextStageConfig = allStages.find((s: any) => s.order === nextStageOrder);
    if (nextStageConfig && nextStageConfig.approverUserId) {
      emitUserEvent(nextStageConfig.approverUserId, 'salary_pending_approval' as any, {
        salaryRecordId,
        month: record.month,
        year: record.year,
        stageName: nextStageConfig.name,
      });

      // Create attendance notification record if model exists
      try {
        await (prisma as any).attendanceNotification.create({
          data: {
            workspaceId,
            userId: nextStageConfig.approverUserId,
            title: 'Salary Record Pending Approval',
            message: `Salary calculation for ${record.month}/${record.year} is waiting for your stage (${nextStageConfig.name}) approval.`,
            type: 'SALARY_APPROVAL',
          },
        });
      } catch (ignored) {}
    }
  }

  return updated;
};

/**
 * Edit salary amounts (Bonus, Deduction, Advance, Final Salary) before final approval with audit tracking
 */
export const editSalaryBeforeApproval = async (
  salaryRecordId: string,
  input: EditSalaryBeforeApprovalInput,
  workspaceId: string,
  editorUserId: string,
) => {
  const record = await (prisma as any).salaryRecord.findFirst({
    where: { id: salaryRecordId, workspaceId },
  });

  if (!record) {
    const err: any = new Error('Salary record not found.');
    err.statusCode = 404;
    throw err;
  }

  if (record.status !== SalaryRecordStatus.PENDING_APPROVAL) {
    const err: any = new Error('Salary can only be edited while in PENDING_APPROVAL status.');
    err.statusCode = 400;
    throw err;
  }

  const newBonus = input.bonus !== undefined ? input.bonus : record.bonus;
  const newDeduction = input.deduction !== undefined ? input.deduction : record.deduction;
  const newAdvance = input.advanceAmount !== undefined ? input.advanceAmount : record.advanceAmount;

  let newFinal = input.finalSalary !== undefined
    ? input.finalSalary
    : Math.max(0, Math.round((record.monthlySalary - newDeduction - newAdvance + newBonus) * 100) / 100);

  const previousValue = {
    bonus: record.bonus,
    deduction: record.deduction,
    advanceAmount: record.advanceAmount,
    finalSalary: record.finalSalary,
  };

  const newValue = {
    bonus: newBonus,
    deduction: newDeduction,
    advanceAmount: newAdvance,
    finalSalary: newFinal,
  };

  const updated = await (prisma as any).salaryRecord.update({
    where: { id: salaryRecordId },
    data: {
      bonus: newBonus,
      deduction: newDeduction,
      advanceAmount: newAdvance,
      finalSalary: newFinal,
    },
  });

  await (prisma as any).salaryHistory.create({
    data: {
      salaryRecordId,
      editedById: editorUserId,
      action: 'EDITED_BEFORE_APPROVAL',
      previousValue,
      newValue,
      reason: input.reason,
    },
  });

  return updated;
};

/**
 * Get audit history timeline for a salary record
 */
export const getSalaryHistory = async (salaryRecordId: string, workspaceId: string) => {
  const record = await (prisma as any).salaryRecord.findFirst({
    where: { id: salaryRecordId, workspaceId },
  });

  if (!record) {
    const err: any = new Error('Salary record not found.');
    err.statusCode = 404;
    throw err;
  }

  const histories = await (prisma as any).salaryHistory.findMany({
    where: { salaryRecordId },
    orderBy: { createdAt: 'asc' },
    include: {
      editedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          profileImageUrl: true,
          role: { select: { id: true, name: true } },
        },
      },
    },
  });

  const approvals = await (prisma as any).salaryApproval.findMany({
    where: { salaryRecordId },
    orderBy: { createdAt: 'asc' },
    include: {
      approverUser: {
        select: {
          id: true,
          name: true,
          email: true,
          role: { select: { id: true, name: true } },
        },
      },
    },
  });

  return {
    record,
    histories,
    approvals,
  };
};
