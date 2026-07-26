import { SalaryRecordStatus, SalaryApprovalAction } from '@prisma/client';

export interface GenerateSalaryInput {
  month: number; // 1-12
  year: number;  // e.g. 2026
  scope: 'SINGLE' | 'DEPARTMENT' | 'OFFICE' | 'COMPANY' | 'employee' | 'department' | 'office' | 'company';
  targetId?: string; // userId, departmentId, or officeId depending on scope
  userId?: string;
  departmentId?: string;
  officeId?: string;
  workingDays?: number; // Total working days override (default 26 or calendar working days)
}

export interface UpdateSalaryCalculationInput {
  bonus?: number;
  deduction?: number;
  advanceAmount?: number;
  remarks?: string;
}

export interface CreateApprovalStageInput {
  name: string;
  order: number;
  approverUserId: string;
  designation?: string;
  isMandatory?: boolean;
  isActive?: boolean;
}

export interface UpdateApprovalStageInput {
  name?: string;
  order?: number;
  approverUserId?: string;
  designation?: string;
  isMandatory?: boolean;
  isActive?: boolean;
}

export interface ReorderApprovalStagesInput {
  stages: { id: string; order: number }[];
}

export interface SalaryReleaseSettingInput {
  salaryReleaseDay: number; // 1-31
}

export interface ProcessApprovalInput {
  action: 'APPROVE' | 'REJECT' | 'RETURN';
  remarks?: string;
}

export interface EditSalaryBeforeApprovalInput {
  bonus?: number;
  deduction?: number;
  advanceAmount?: number;
  finalSalary?: number;
  reason: string;
}
