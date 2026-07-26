import { z } from 'zod';

export const generateSalarySchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  scope: z.enum(['SINGLE', 'DEPARTMENT', 'OFFICE', 'COMPANY', 'employee', 'department', 'office', 'company']),
  targetId: z.string().optional(),
  userId: z.string().optional(),
  departmentId: z.string().optional(),
  officeId: z.string().optional(),
  workingDays: z.number().int().min(1).max(31).optional(),
});

export const updateSalaryCalculationSchema = z.object({
  bonus: z.number().min(0).optional(),
  deduction: z.number().min(0).optional(),
  advanceAmount: z.number().min(0).optional(),
  remarks: z.string().max(1000).optional(),
});

export const createApprovalStageSchema = z.object({
  name: z.string().trim().min(2).max(100),
  order: z.number().int().min(1),
  approverUserId: z.string().min(1, 'Approver user is required'),
  designation: z.string().trim().max(100).optional(),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateApprovalStageSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  order: z.number().int().min(1).optional(),
  approverUserId: z.string().min(1).optional(),
  designation: z.string().trim().max(100).optional(),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const reorderApprovalStagesSchema = z.object({
  stages: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(1),
    }),
  ).min(1),
});

export const salaryReleaseSettingSchema = z.object({
  salaryReleaseDay: z.number().int().min(1).max(31),
});

export const processApprovalSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'RETURN']),
  remarks: z.string().max(1000).optional(),
});

export const editSalaryBeforeApprovalSchema = z.object({
  bonus: z.number().min(0).optional(),
  deduction: z.number().min(0).optional(),
  advanceAmount: z.number().min(0).optional(),
  finalSalary: z.number().min(0).optional(),
  reason: z.string().trim().min(3, 'Reason is required for editing salary during approval').max(1000),
});
