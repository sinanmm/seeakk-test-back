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

  // STRICT RULE: Pending approvals appear ONLY for currentApproverUserId (or SuperAdmin override)
  let where: any = {
    workspaceId,
    status: SalaryRecordStatus.PENDING_APPROVAL,
  };

  if (!isSuperAdmin) {
    where.currentApproverUserId = approverUserId;
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
        currentApproverUser: { select: { id: true, name: true, email: true } },
        currentApprovalStage: { select: { id: true, name: true, order: true } },
        approvals: {
          orderBy: { createdAt: 'asc' },
          include: {
            approverUser: { select: { id: true, name: true, email: true } },
          },
        },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            editedBy: { select: { id: true, name: true, email: true, role: { select: { id: true, name: true } } } },
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
  isSuperAdmin = false,
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

  // Strictly enforce that ONLY currentApproverUserId (or SuperAdmin) can process this approval
  const isAuthorizedApprover = isSuperAdmin || (record.currentApproverUserId ? record.currentApproverUserId === approverUserId : true);
  if (!isAuthorizedApprover) {
    const err: any = new Error('You are not the designated approver for the current approval stage.');
    err.statusCode = 403;
    throw err;
  }

  // Fetch all active approval stages in workspace ordered by order
  const allStages = await (prisma as any).salaryApprovalStage.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { order: 'asc' },
  });

  const maxStageOrder = allStages.length > 0 ? Math.max(...allStages.map((s: any) => s.order)) : 1;

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
        currentApprovalStageId: null,
        currentApproverUserId: null,
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
        stageOrder: record.currentStageOrder,
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
        currentApprovalStageId: null,
        currentApproverUserId: null,
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
        stageOrder: record.currentStageOrder,
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
  const nextStage = allStages.find((s: any) => s.order > record.currentStageOrder);
  const isFinalStage = !nextStage || record.currentStageOrder >= maxStageOrder || allStages.length === 0;

  let updatedStatus = record.status;
  let nextStageOrder = record.currentStageOrder;
  let nextStageId: string | null = record.currentApprovalStageId;
  let nextApproverUserId: string | null = record.currentApproverUserId;

  if (isFinalStage) {
    updatedStatus = SalaryRecordStatus.APPROVED;
    nextStageId = null;
    nextApproverUserId = null;
  } else if (nextStage) {
    nextStageOrder = nextStage.order;
    nextStageId = nextStage.id;
    nextApproverUserId = nextStage.approverUserId;
  }

  const updated = await (prisma as any).salaryRecord.update({
    where: { id: salaryRecordId },
    data: {
      status: updatedStatus,
      currentStageOrder: nextStageOrder,
      currentApprovalStageId: nextStageId,
      currentApproverUserId: nextApproverUserId,
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
      stageOrder: record.currentStageOrder,
      reason: input.remarks ? input.remarks.trim() : 'Approved',
    },
  });

  if (isFinalStage) {
    // Notify employee & generator when final stage completes
    emitUserEvent(record.userId, 'salary_finalized' as any, {
      salaryRecordId,
      month: record.month,
      year: record.year,
      finalSalary: updated.finalSalary,
    });
    if (record.generatedById !== record.userId) {
      emitUserEvent(record.generatedById, 'salary_finalized' as any, {
        salaryRecordId,
        month: record.month,
        year: record.year,
        finalSalary: updated.finalSalary,
      });
    }
  } else if (nextStage && nextApproverUserId) {
    // Notify ONLY the next stage approver
    emitUserEvent(nextApproverUserId, 'salary_pending_approval' as any, {
      salaryRecordId,
      month: record.month,
      year: record.year,
      stageName: nextStage.name,
    });

    try {
      await (prisma as any).attendanceNotification.create({
        data: {
          workspaceId,
          userId: nextApproverUserId,
          title: 'Salary Record Pending Approval',
          message: `Salary calculation for ${record.month}/${record.year} is waiting for your stage (${nextStage.name}) approval.`,
          type: 'SALARY_APPROVAL',
        },
      });
    } catch (ignored) {}
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
  isSuperAdmin = false,
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

  if (!input.reason || !input.reason.trim()) {
    const err: any = new Error('Reason for salary adjustment is mandatory.');
    err.statusCode = 400;
    throw err;
  }

  // Strictly verify currentApproverUserId authorization
  const isAuthorizedApprover = isSuperAdmin || (record.currentApproverUserId ? record.currentApproverUserId === editorUserId : true);
  if (!isAuthorizedApprover) {
    const err: any = new Error('You are not the designated approver for the current approval stage.');
    err.statusCode = 403;
    throw err;
  }

  const newBonus = input.bonus !== undefined ? input.bonus : record.bonus;
  const newDeduction = input.deduction !== undefined ? input.deduction : record.deduction;
  const newAdvance = input.advanceAmount !== undefined ? input.advanceAmount : record.advanceAmount;

  let newFinal = input.finalSalary !== undefined
    ? input.finalSalary
    : Math.max(0, Math.round((record.monthlySalary - newDeduction - newAdvance + newBonus) * 100) / 100);

  const previousSalary = record.finalSalary;
  const updatedSalary = newFinal;
  const difference = Math.round((updatedSalary - previousSalary) * 100) / 100;

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
      previousSalary,
      updatedSalary,
      difference,
      previousBonus: record.bonus,
      updatedBonus: newBonus,
      previousDeduction: record.deduction,
      updatedDeduction: newDeduction,
      previousAdvance: record.advanceAmount,
      updatedAdvance: newAdvance,
      stageOrder: record.currentStageOrder,
      previousValue,
      newValue,
      reason: input.reason.trim(),
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
