import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { GenerateSalaryInput, UpdateSalaryCalculationInput } from './salary.types';
import { SalaryRecordStatus } from '@prisma/client';
import { emitUserEvent } from '../../realtime/socket';

/**
 * Calculates working days in a given month and year excluding Sundays/Weekly off
 */
const getDefaultWorkingDays = (month: number, year: number): number => {
  const totalDays = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month - 1, day);
    // Exclude Sundays (0) by default
    if (date.getDay() !== 0) {
      workingDays++;
    }
  }
  return workingDays || 26;
};

/**
 * Generate salary records for scoped employees
 */
export const generateSalary = async (
  input: GenerateSalaryInput,
  workspaceId: string,
  generatedById: string,
) => {
  const { month, year, scope: rawScope, targetId: rawTargetId, userId, departmentId, officeId, workingDays: customWorkingDays } = input;
  const numWorkingDays = customWorkingDays || getDefaultWorkingDays(month, year);

  const scopeUpper = (rawScope || '').toUpperCase();
  let normalizedScope = 'COMPANY';
  if (scopeUpper === 'EMPLOYEE' || scopeUpper === 'SINGLE' || scopeUpper === 'USER') {
    normalizedScope = 'SINGLE';
  } else if (scopeUpper === 'DEPARTMENT') {
    normalizedScope = 'DEPARTMENT';
  } else if (scopeUpper === 'OFFICE') {
    normalizedScope = 'OFFICE';
  }

  logger.info(`=================== Salary Generation Started ===================`);
  logger.info(`Selected Month: ${month}`);
  logger.info(`Selected Year: ${year}`);
  logger.info(`Raw Scope: ${rawScope}, Normalized Scope: ${normalizedScope}`);
  logger.info(`Target ID: ${rawTargetId || 'N/A'}, userId: ${userId || 'N/A'}, departmentId: ${departmentId || 'N/A'}, officeId: ${officeId || 'N/A'}`);
  logger.info(`Workspace ID: ${workspaceId}`);
  logger.info(`Configured Working Days: ${numWorkingDays}`);

  // 1. Resolve Target Users
  let userWhereClause: any = {
    workspaceId,
    deletedAt: null,
    isActive: true,
  };

  if (normalizedScope === 'SINGLE') {
    const targetUserId = userId || rawTargetId;
    if (!targetUserId) {
      logger.error('Salary Generation Error: Target user ID is required for Single Employee scope.');
      const err: any = new Error('Target user ID is required for Single Employee scope.');
      err.statusCode = 400;
      throw err;
    }
    userWhereClause.id = targetUserId;
  } else if (normalizedScope === 'DEPARTMENT') {
    const targetDeptId = departmentId || rawTargetId;
    if (!targetDeptId) {
      logger.error('Salary Generation Error: Target department ID is required for Entire Department scope.');
      const err: any = new Error('Target department ID is required for Entire Department scope.');
      err.statusCode = 400;
      throw err;
    }
    userWhereClause.departmentId = targetDeptId;
  } else if (normalizedScope === 'OFFICE') {
    const targetOfficeId = officeId || rawTargetId;
    if (!targetOfficeId) {
      logger.error('Salary Generation Error: Target office ID is required for Entire Office scope.');
      const err: any = new Error('Target office ID is required for Entire Office scope.');
      err.statusCode = 400;
      throw err;
    }
    userWhereClause.officeId = targetOfficeId;
  } else if (normalizedScope === 'COMPANY') {
    // Optional filters if passed alongside COMPANY scope
    if (departmentId) {
      userWhereClause.departmentId = departmentId;
    }
    if (officeId) {
      userWhereClause.officeId = officeId;
    }
    if (userId) {
      userWhereClause.id = userId;
    }
  }

  logger.info(`Executing User Find Query with clause: ${JSON.stringify(userWhereClause)}`);

  const users = await (prisma as any).user.findMany({
    where: userWhereClause,
    select: {
      id: true,
      name: true,
      monthlySalary: true,
      isActive: true,
      department: { select: { id: true, name: true } },
      office: { select: { id: true, name: true } },
    },
  });

  logger.info(`Employees Found: ${users ? users.length : 0}`);

  if (!users || users.length === 0) {
    logger.warn(`No active employees found matching scope ${normalizedScope} in workspace ${workspaceId}.`);
    const err: any = new Error('No active employees found for the specified scope.');
    err.statusCode = 404;
    throw err;
  }

  // Construct month boundaries in UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  const daysInMonth = new Date(year, month, 0).getDate();
  const startIso = `${year}-${pad(month)}-01T00:00:00.000Z`;
  const endIso = `${year}-${pad(month)}-${pad(daysInMonth)}T23:59:59.999Z`;

  const startDate = new Date(startIso);
  const endDate = new Date(endIso);

  logger.info(`Attendance Search Range: ${startIso} to ${endIso}`);

  // Fetch active holidays for workspace in the month range
  let monthHolidays: any[] = [];
  try {
    monthHolidays = await (prisma as any).holiday.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        holidayDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        offices: {
          select: { officeId: true },
        },
      },
    });
    logger.info(`Workspace Active Holidays Found in Period: ${monthHolidays.length}`);
  } catch (e: any) {
    logger.warn(`Holiday fetch query warning: ${e?.message}`);
  }

  const results: any[] = [];
  const skipped: any[] = [];

  for (const user of users) {
    logger.info(`--------------------------------------------------`);
    logger.info(`Checking Employee: ID=${user.id}, Name="${user.name || 'Unnamed'}", Dept="${user.department?.name || 'None'}", Office="${user.office?.name || 'None'}"`);

    try {
      const baseSalary = user.monthlySalary ?? 0;
      logger.info(`  Configured Monthly Salary: ${baseSalary}`);

      if (!baseSalary || baseSalary <= 0) {
        const reason = 'Monthly salary not configured or non-positive (set monthly salary in User Management)';
        logger.warn(`  [SKIP REASON] Employee "${user.name || user.id}": ${reason}`);
        skipped.push({
          userId: user.id,
          name: user.name || 'User',
          reason,
        });
        continue;
      }

      // Check duplicate salary generation for same employee + month + year
      const existing = await (prisma as any).salaryRecord.findUnique({
        where: {
          workspaceId_userId_month_year: {
            workspaceId,
            userId: user.id,
            month,
            year,
          },
        },
      });

      if (existing) {
        logger.info(`  Existing Salary Record Found: ID=${existing.id}, Status=${existing.status}`);

        if (
          existing.status !== SalaryRecordStatus.DRAFT &&
          existing.status !== SalaryRecordStatus.RETURNED &&
          existing.status !== SalaryRecordStatus.REJECTED
        ) {
          const reason = `Skipped because salary already generated and in status "${existing.status}"`;
          logger.warn(`  [SKIP REASON] Employee "${user.name || user.id}": ${reason}`);
          skipped.push({
            userId: user.id,
            name: user.name || 'User',
            reason,
          });
          continue;
        } else {
          logger.info(`  Existing salary record is in editable status (${existing.status}). Re-calculating and updating record.`);
        }
      } else {
        logger.info(`  Existing Salary Record: None found for ${user.name || user.id}. New record will be created.`);
      }

      // Determine office holidays applicable to this employee
      const userOfficeId = user.office?.id || null;
      const applicableOfficeHolidays = monthHolidays.filter((h: any) => {
        if (!h.offices || h.offices.length === 0) return true;
        if (!userOfficeId) return true;
        return h.offices.some((ho: any) => ho.officeId === userOfficeId);
      });

      logger.info(`  Applicable Office Holidays for Employee: ${applicableOfficeHolidays.length}`);

      // Fetch attendance records for the month
      const attendanceRecords = await (prisma as any).attendanceRecord.findMany({
        where: {
          workspaceId,
          userId: user.id,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      logger.info(`  Attendance Records Count: ${attendanceRecords.length} found between ${startIso} and ${endIso}`);

      let attendanceDays = 0;
      let leaveDays = 0;
      let absentDays = 0;

      const recordDates = new Set<string>();

      for (const rec of attendanceRecords) {
        if (rec.date) {
          const dStr = new Date(rec.date).toISOString().split('T')[0];
          recordDates.add(dStr);
        }

        if (rec.attendanceType === 'PRESENT' || rec.attendanceType === 'WORK_FROM_HOME') {
          attendanceDays += 1;
        } else if (rec.attendanceType === 'HALF_DAY') {
          attendanceDays += 0.5;
        } else if (rec.attendanceType === 'LEAVE') {
          if (rec.approvalStatus === 'APPROVED' && rec.isPaidLeave === true) {
            leaveDays += 1;
          } else {
            absentDays += 1;
          }
        } else if (rec.attendanceType === 'HOLIDAY' || rec.attendanceType === 'WEEKLY_OFF') {
          leaveDays += 1;
        } else if (rec.attendanceType === 'ABSENT') {
          absentDays += 1;
        }
      }

      // Account for office holidays not already covered in attendance records
      for (const hol of applicableOfficeHolidays) {
        if (hol.holidayDate) {
          const holDateStr = new Date(hol.holidayDate).toISOString().split('T')[0];
          if (!recordDates.has(holDateStr)) {
            leaveDays += 1;
            recordDates.add(holDateStr);
          }
        }
      }

      const totalAccountedDays = attendanceDays + leaveDays;
      const lopDays = Math.max(0, numWorkingDays - totalAccountedDays);

      logger.info(`  Attendance Summary: Present=${attendanceDays}, Paid Leave/Holiday/Off=${leaveDays}, Absent=${absentDays}, Total Accounted=${totalAccountedDays}, Calculated LOP Days=${lopDays}`);

      // Calculate Daily Salary and Net Salary
      const dailySalary = baseSalary / numWorkingDays;
      const lopDeduction = dailySalary * lopDays;

      // Fetch advance payments if any
      let totalAdvance = 0;
      try {
        const advancePayments = await (prisma as any).advancePayment.findMany({
          where: {
            workspaceId,
            requestedById: user.id,
            status: 'APPROVED',
          },
        });
        totalAdvance = advancePayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      } catch (e: any) {
        logger.warn(`  Advance Payment query note: ${e?.message}`);
      }

      const bonus = 0;
      const deduction = Math.round(lopDeduction * 100) / 100;
      const finalSalary = Math.max(0, Math.round((baseSalary - deduction + bonus) * 100) / 100);

      logger.info(`  Calculation Result: BaseSalary=${baseSalary}, DailyRate=${dailySalary.toFixed(2)}, Deduction=${deduction}, Advance=${totalAdvance}, FinalSalary=${finalSalary}`);

      let record: any;
      if (existing) {
        // Overwrite/re-calculate existing DRAFT / REJECTED / RETURNED record
        record = await (prisma as any).salaryRecord.update({
          where: { id: existing.id },
          data: {
            monthlySalary: baseSalary,
            workingDays: numWorkingDays,
            attendanceDays,
            leaveDays,
            lopDays,
            bonus,
            deduction,
            advanceAmount: totalAdvance,
            finalSalary,
            status: SalaryRecordStatus.DRAFT,
            currentStageOrder: 1,
            generatedById,
          },
        });
        logger.info(`  Salary Record Updated: ID=${record.id}`);
      } else {
        record = await (prisma as any).salaryRecord.create({
          data: {
            workspaceId,
            userId: user.id,
            month,
            year,
            monthlySalary: baseSalary,
            workingDays: numWorkingDays,
            attendanceDays,
            leaveDays,
            lopDays,
            bonus,
            deduction,
            advanceAmount: totalAdvance,
            finalSalary,
            status: SalaryRecordStatus.DRAFT,
            currentStageOrder: 1,
            generatedById,
          },
        });
        logger.info(`  Salary Record Created: ID=${record.id}`);
      }

      // Log history entry
      await (prisma as any).salaryHistory.create({
        data: {
          salaryRecordId: record.id,
          editedById: generatedById,
          action: 'GENERATED',
          newValue: {
            monthlySalary: baseSalary,
            workingDays: numWorkingDays,
            attendanceDays,
            leaveDays,
            lopDays,
            finalSalary,
          },
          reason: 'Salary record generated automatically',
        },
      });

      results.push(record);
      logger.info(`  [SUCCESS] Salary Saved for ${user.name || user.id}`);
    } catch (err: any) {
      logger.error(`  [ERROR] Calculation failed for employee "${user.name || user.id}": ${err?.message}`, {
        stack: err?.stack,
      });
      skipped.push({
        userId: user.id,
        name: user.name || 'User',
        reason: `Skipped due to error: ${err?.message || 'Unknown calculation error'}`,
      });
    }
  }

  logger.info(`=================== Salary Generation Completed ===================`);
  logger.info(`Generated Count: ${results.length}`);
  logger.info(`Skipped Count: ${skipped.length}`);
  if (skipped.length > 0) {
    logger.info(`Skipped Summary: ${JSON.stringify(skipped, null, 2)}`);
  }

  return {
    generatedCount: results.length,
    skippedCount: skipped.length,
    records: results,
    skipped,
  };
};

/**
 * Submit salary records from DRAFT to PENDING_APPROVAL
 */
export const submitSalaryForApproval = async (salaryRecordIds: string[], workspaceId: string, actorId: string) => {
  const records = await (prisma as any).salaryRecord.findMany({
    where: {
      id: { in: salaryRecordIds },
      workspaceId,
    },
  });

  if (!records || records.length === 0) {
    const err: any = new Error('No matching salary records found.');
    err.statusCode = 404;
    throw err;
  }

  const stages = await (prisma as any).salaryApprovalStage.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { order: 'asc' },
  });

  const firstStage = stages.length > 0 ? stages[0] : null;

  const updated = [];
  for (const record of records) {
    if (record.status !== SalaryRecordStatus.DRAFT && record.status !== SalaryRecordStatus.RETURNED) {
      continue;
    }

    const targetStatus = firstStage ? SalaryRecordStatus.PENDING_APPROVAL : SalaryRecordStatus.APPROVED;
    const targetOrder = firstStage ? firstStage.order : 1;
    const targetStageId = firstStage ? firstStage.id : null;
    const targetApproverId = firstStage ? firstStage.approverUserId : null;

    const updatedRec = await (prisma as any).salaryRecord.update({
      where: { id: record.id },
      data: {
        status: targetStatus,
        currentStageOrder: targetOrder,
        currentApprovalStageId: targetStageId,
        currentApproverUserId: targetApproverId,
      },
    });

    await (prisma as any).salaryHistory.create({
      data: {
        salaryRecordId: record.id,
        editedById: actorId,
        action: 'SUBMITTED_FOR_APPROVAL',
        stageOrder: targetOrder,
        reason: 'Submitted for multi-level approval process',
      },
    });

    if (firstStage && targetApproverId) {
      emitUserEvent(targetApproverId, 'salary_pending_approval' as any, {
        salaryRecordId: record.id,
        month: record.month,
        year: record.year,
        stageName: firstStage.name,
      });

      try {
        await (prisma as any).attendanceNotification.create({
          data: {
            workspaceId,
            userId: targetApproverId,
            title: 'Salary Record Pending Approval',
            message: `Salary calculation for ${record.month}/${record.year} is waiting for your stage (${firstStage.name}) approval.`,
            type: 'SALARY_APPROVAL',
          },
        });
      } catch (ignored) {}
    }

    updated.push(updatedRec);
  }

  return { submittedCount: updated.length, records: updated };
};

/**
 * List salary calculations with filters
 */
export const listSalaryCalculations = async (
  query: { month?: number; year?: number; departmentId?: string; officeId?: string; status?: SalaryRecordStatus; page?: number; limit?: number; search?: string },
  workspaceId: string,
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const where: any = { workspaceId };
  if (query.month) where.month = Number(query.month);
  if (query.year) where.year = Number(query.year);
  if (query.status) where.status = query.status;

  if (query.departmentId) {
    where.user = { ...where.user, departmentId: query.departmentId };
  }
  if (query.officeId) {
    where.user = { ...where.user, officeId: query.officeId };
  }
  if (query.search) {
    const term = query.search.trim();
    where.user = {
      ...where.user,
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
        generatedBy: {
          select: { id: true, name: true, email: true },
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
 * Update manual adjustments (bonus, deduction, advance) for a draft salary calculation
 */
export const updateSalaryCalculation = async (
  id: string,
  input: UpdateSalaryCalculationInput,
  workspaceId: string,
  actorId: string,
) => {
  const record = await (prisma as any).salaryRecord.findFirst({
    where: { id, workspaceId },
  });

  if (!record) {
    const err: any = new Error('Salary record not found.');
    err.statusCode = 404;
    throw err;
  }

  const bonus = input.bonus !== undefined ? input.bonus : record.bonus;
  const deduction = input.deduction !== undefined ? input.deduction : record.deduction;
  const advanceAmount = input.advanceAmount !== undefined ? input.advanceAmount : record.advanceAmount;
  const remarks = input.remarks !== undefined ? input.remarks : record.remarks;

  const finalSalary = Math.max(0, Math.round((record.monthlySalary - deduction - advanceAmount + bonus) * 100) / 100);

  const previousValue = {
    bonus: record.bonus,
    deduction: record.deduction,
    advanceAmount: record.advanceAmount,
    finalSalary: record.finalSalary,
  };

  const updated = await (prisma as any).salaryRecord.update({
    where: { id },
    data: {
      bonus,
      deduction,
      advanceAmount,
      finalSalary,
      remarks,
    },
  });

  await (prisma as any).salaryHistory.create({
    data: {
      salaryRecordId: id,
      editedById: actorId,
      action: 'CALCULATION_UPDATED',
      previousValue,
      newValue: { bonus, deduction, advanceAmount, finalSalary },
      reason: input.remarks || 'Manual salary calculation update',
    },
  });

  return updated;
};

/**
 * Delete a draft salary calculation
 */
export const deleteSalaryCalculation = async (id: string, workspaceId: string) => {
  const record = await (prisma as any).salaryRecord.findFirst({
    where: { id, workspaceId },
  });

  if (!record) {
    const err: any = new Error('Salary record not found.');
    err.statusCode = 404;
    throw err;
  }

  if (record.status === SalaryRecordStatus.APPROVED) {
    const err: any = new Error('Approved salary records cannot be deleted.');
    err.statusCode = 400;
    throw err;
  }

  await (prisma as any).salaryRecord.delete({ where: { id } });
  return { message: 'Salary calculation deleted successfully.' };
};
