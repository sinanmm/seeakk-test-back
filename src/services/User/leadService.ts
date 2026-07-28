import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import { formatPhoneStr } from '../../utils/phoneUtils';
import ExcelJS from 'exceljs';
import moment from 'moment-timezone';
import { getWorkspaceTimeZone } from './followupService';
import { normalizeFollowUpType } from '../../constants/followUpType';
import { buildAccessWhere, buildClosureUpdateData, isClosureStage, resolveLeadVisibilityMode } from '../../modules/leads/leads.service';
import { buildLeadOutcomeFlagsFromStage, isClosedWonStage, isLobStage } from '../../modules/leads/leadVisibility.util';
import * as leadApprovalService from '../../modules/leads/leadApprovals.service';
import { validateLeadStageTransition } from '../../modules/master/lead-stages/leadStage.service';
import { getActiveStageRulesForExecution } from '../../modules/master/stage-rules/stageRule.service';
import { assertActiveLOBReason } from '../../modules/master/lob-reasons/lobReasons.service';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExportLeadsQueryInput,
  ListLeadsQueryInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';
import { touchFollowUpTodayCachesAfterLeadMutation } from './followupService';

import { buildLeadChangesToTrack, trackFieldEdits } from '../../modules/admin/field-highlights/fieldHighlights.interceptor';

import { hasPermission } from '../../middlewares/authMiddleware';

const LEADS_CACHE_TTL_SECONDS = 60;

export const validateClosedStageBalance = async (leadId: string, targetStageId: string, workspaceId: string) => {
  const stage = await prisma.leadStage.findFirst({
    where: { id: targetStageId, workspaceId, deletedAt: null },
    select: { isClosed: true, name: true }
  });
  if (stage?.isClosed) {
    const lead = await (prisma as any).lead.findUnique({
      where: { id: leadId },
      select: { totalAmount: true }
    });
    const approvedSumResult = await (prisma as any).advancePayment.aggregate({
      where: { leadId, status: 'APPROVED' },
      _sum: { amount: true }
    });
    const totalAmount = lead?.totalAmount || 0;
    const approvedSum = approvedSumResult._sum.amount || 0;
    const balance = totalAmount - approvedSum;
    if (balance > 0) {
      const error = new Error('Outstanding balance remaining. Please complete the payment before closing this lead.') as Error & { statusCode: number };
      error.statusCode = 422;
      throw error;
    }
  }
};

export const syncLeadRevenueTransaction = async (tx: any, workspaceId: string, leadId: string, stageId: string | null, actorId: string) => {
  if (!stageId) return;
  const stage = await tx.leadStage.findFirst({
    where: { id: stageId, workspaceId, deletedAt: null },
    select: { isClosed: true, isLOB: true }
  });
  const isClosedWon = Boolean(stage?.isClosed && !stage?.isLOB);

  const existing = await tx.revenueTransaction.findFirst({
    where: { leadId }
  });

  if (isClosedWon) {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { totalAmount: true, assignedToId: true, createdById: true }
    });

    const approvedAdvances = await tx.advancePayment.aggregate({
      where: { leadId, status: 'APPROVED' },
      _sum: { amount: true }
    });

    const totalAmount = lead?.totalAmount || 0;
    const approvedSum = approvedAdvances._sum.amount || 0;
    const balance = totalAmount - approvedSum;

    if (balance === 0 && totalAmount > 0) {
      const closingUserId = lead?.assignedToId || lead?.createdById || actorId;
      if (!existing) {
        await tx.revenueTransaction.create({
          data: {
            workspaceId,
            leadId,
            userId: closingUserId,
            approvedById: actorId,
            amount: totalAmount,
            closedStageId: stageId
          }
        });
      } else {
        await tx.revenueTransaction.update({
          where: { id: existing.id },
          data: {
            amount: totalAmount,
            userId: closingUserId,
            approvedById: actorId,
            closedStageId: stageId
          }
        });
      }
    } else if (existing) {
      await tx.revenueTransaction.delete({
        where: { id: existing.id }
      });
    }
  } else if (existing) {
    await tx.revenueTransaction.delete({
      where: { id: existing.id }
    });
  }
};

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type SlaAction = 'AUTO_LOB' | 'WARN_AND_CHOOSE';

type LeadSlaSnapshot = {
  stageEnteredAt: Date | null;
  stageExpiresAt: Date | null;
  slaAction: SlaAction | null;
  slaWarningDays: number | null;
};

type LeadIncludeRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  address: string | null;
  remarks: string | null;
  profileImageUrl: string | null;
  profileImageThumbnail: string | null;
  profileImageUploadedAt: Date | null;
  profileImageUploadedById: string | null;
  expectedRevenue: number | null;
  totalAmount: number | null;
  generatedRevenue: number;
  assignedToId: string | null;
  stageId: string | null;
  lifecycleId: string | null;
  sourceId: string | null;
  nextFollowUpAt: Date | null;
  stageEnteredAt: Date | null;
  stageExpiresAt: Date | null;
  slaAction: SlaAction | null;
  slaWarningDays: number | null;
  approvalState: 'NONE' | 'PENDING';
  pendingApprovalToStageId: string | null;
  pendingApprovalRequestedAt: Date | null;
  isClosed: boolean;
  isLOB: boolean;
  closedAt: Date | null;
  closedById: string | null;
  closureType: 'WON' | 'LOST' | 'CANCELLED' | null;
  workspaceId: string;
  createdById: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedTo: { id: string; name: string | null; username: string | null; email: string; supervisorId: string | null; office: { id: string; name: string } | null } | null;
  stage: { id: string; name: string; color: string; isLOB: boolean; isClosed: boolean } | null;
  lifecycle: { id: string; name: string; isDefault: boolean } | null;
  source: { id: string; name: string; status: string } | null;
  createdBy: { id: string; name: string | null; username: string | null; email: string };
  closedBy: { id: string; name: string | null; username: string | null; email: string } | null;
  followUps: Array<{
    id: string;
    type: string;
    description: string | null;
    completionDescription: string | null;
    recentDescription: string | null;
    scheduledAt: Date;
    completedAt: Date | null;
    status: string;
    updatedAt: Date;
  }>;
  advancePayments: Array<{ amount: number }>;
  remarksList: Array<{ text: string; createdAt: Date }>;
  activities: Array<{ action: string; metadata: any; createdAt: Date }>;

  lobLogs: Array<{
    id: string;
    reasonId: string;
    reason: { name: string } | null;
    remarks: string | null;
    previousStageId: string | null;
    previousStageName: string | null;
    changedById: string;
    changedAt: Date;
  }>;
  products?: Array<{
    id: string;
    productId: string | null;
    productName: string;
    productCode: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

const createServiceError = (
  message: string,
  statusCode: number,
  errorCode?: string,
): Error & { statusCode: number; errorCode?: string } => {
  const error = new Error(message) as Error & { statusCode: number; errorCode?: string };
  error.statusCode = statusCode;
  if (errorCode) error.errorCode = errorCode;
  return error;
};

const normalizeRoleKey = (role?: string | null): string =>
  (role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const isManagerialRole = (role?: string | null): boolean => {
  const normalized = normalizeRoleKey(role);
  return normalized === 'admin' || normalized === 'superadmin' || normalized === 'manager';
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string } | null): string => {
  if (!user) return '';
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email || '';
};

const leadRelationSelect = {
  assignedTo: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      profileImageUrl: true,
      supervisorId: true,
      office: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  stage: {
    select: {
      id: true,
      name: true,
      color: true,
      isLOB: true,
      isClosed: true,
    },
  },
  lifecycle: {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  },
  source: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      profileImageUrl: true,
    },
  },
  closedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      profileImageUrl: true,
    },
  },
  followUps: {
    orderBy: [{ updatedAt: 'desc' as const }, { scheduledAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 25,
    select: {
      id: true,
      type: true,
      description: true,
      completionDescription: true,
      recentDescription: true,
      scheduledAt: true,
      completedAt: true,
      status: true,
      updatedAt: true,
    },
  },
  advancePayments: {
    where: { status: 'APPROVED' },
    select: { amount: true },
  },
  remarksList: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { text: true, createdAt: true },
  },
  activities: {
    where: {
      action: {
        in: [
          'REMARK_ADDED',
          'LEAD_REMARKS_CREATED',
          'STAGE_CHANGED',
          'ADVANCE_PAYMENT_REQUESTED',
          'ADVANCE_PAYMENT_APPROVED',
          'ADVANCE_PAYMENT_REJECTED',
          'LOB_RETURN',
          'LEAD_PROFILE_IMAGE_UPLOADED',
          'LEAD_PROFILE_IMAGE_UPDATED',
          'LEAD_PROFILE_IMAGE_REMOVED',
        ],
      },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { action: true, metadata: true, createdAt: true },
  },
  lobLogs: {
    orderBy: { changedAt: 'desc' as const },
    take: 1,
    select: { reason: { select: { name: true } }, remarks: true, changedAt: true },
  },
  products: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      productId: true,
      productName: true,
      productCode: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

const leadBaseSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  companyName: true,
  address: true,
  remarks: true,
  expectedRevenue: true,
  totalAmount: true,
  generatedRevenue: true,
  assignedToId: true,
  stageId: true,
  lifecycleId: true,
  sourceId: true,
  nextFollowUpAt: true,
  stageEnteredAt: true,
  stageExpiresAt: true,
  slaAction: true,
  slaWarningDays: true,
  approvalState: true,
  pendingApprovalToStageId: true,
  pendingApprovalRequestedAt: true,
  isClosed: true,
  isLOB: true,
  closedAt: true,
  closedById: true,
  closureType: true,
  workspaceId: true,
  createdById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const leadProfileImageSelect = {
  profileImageUrl: true,
  profileImageThumbnail: true,
  profileImageUploadedAt: true,
  profileImageUploadedById: true,
} as const;

const buildLeadSelect = (includeProfileImageColumns: boolean) => ({
  ...leadBaseSelect,
  ...(includeProfileImageColumns ? leadProfileImageSelect : {}),
  ...leadRelationSelect,
});

const hasGeneratedDelegates = (): boolean => {
  const lead = (prisma as any).lead;
  const followUp = (prisma as any).followUp;
  const leadStar = (prisma as any).leadStar;
  return Boolean(
    lead?.findFirst &&
      lead?.findMany &&
      lead?.create &&
      lead?.update &&
      followUp?.create &&
      leadStar?.findMany &&
      leadStar?.upsert,
  );
};

/**
 * Scalar columns on public.leads required by the current Prisma `Lead` model (@@map("leads")).
 * Keep in sync with prisma/schema.prisma — if a migration adds a column, add it here so production
 * returns a clear 503 instead of a generic Prisma P2022 at query time.
 */
const LEAD_MODEL_DB_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'companyName',
  'address',
  'remarks',
  'expectedRevenue',
  'generatedRevenue',
  'assignedToId',
  'stageId',
  'lifecycleId',
  'sourceId',
  'nextFollowUpAt',
  'stageEnteredAt',
  'stageExpiresAt',
  'slaAction',
  'slaWarningDays',
  'approvalState',
  'pendingApprovalToStageId',
  'pendingApprovalRequestedAt',
  'isClosed',
  'isLOB',
  'closedAt',
  'closedById',
  'closureType',
  'workspaceId',
  'createdById',
  'deletedAt',
  'createdAt',
  'updatedAt',
] as const;

const LEAD_PROFILE_IMAGE_DB_COLUMNS = [
  'profileImageUrl',
  'profileImageThumbnail',
  'profileImageUploadedAt',
  'profileImageUploadedById',
] as const;

let leadsColumnCheckValidUntil = 0;
let profileImageColumnsReadyValidUntil = 0;
let profileImageColumnsReady = false;
const LEADS_COLUMN_CHECK_TTL_MS = 60_000;

const getLeadColumnSet = async (): Promise<Set<string>> => {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  return new Set(rows.map((row) => row.column_name.toLowerCase()));
};

const areLeadProfileImageColumnsReady = async (): Promise<boolean> => {
  if (Date.now() < profileImageColumnsReadyValidUntil) {
    return profileImageColumnsReady;
  }

  const present = await getLeadColumnSet();
  profileImageColumnsReady = LEAD_PROFILE_IMAGE_DB_COLUMNS.every((col) => present.has(col.toLowerCase()));
  profileImageColumnsReadyValidUntil = Date.now() + LEADS_COLUMN_CHECK_TTL_MS;
  return profileImageColumnsReady;
};

export const ensureLeadProfileImageColumnsReady = async (): Promise<void> => {
  if (await areLeadProfileImageColumnsReady()) return;
  logger.error('Lead profile image schema is not ready', {
    missingColumns: LEAD_PROFILE_IMAGE_DB_COLUMNS,
    remediation: 'Run `npx prisma migrate deploy` against the production API DATABASE_URL, then restart the API.',
  });
  throw createServiceError(
    'Lead profile image uploads are temporarily unavailable. Please try again later.',
    503,
    'LEAD_PROFILE_IMAGE_STORAGE_NOT_READY',
  );
};

const ensureLeadsColumnsMatchPrismaModel = async (): Promise<void> => {
  if (Date.now() < leadsColumnCheckValidUntil) {
    return;
  }

  const present = await getLeadColumnSet();
  const missing = LEAD_MODEL_DB_COLUMNS.filter((col) => !present.has(col.toLowerCase()));

  if (missing.length > 0) {
    const companyOrAddress = missing.filter((c) => c === 'companyName' || c === 'address');
    const companyHint =
      companyOrAddress.length > 0
        ? ' Recent UI expects company/address: apply migration `20260420140000_lead_company_address` (included in repo migrations).'
        : '';

    throw createServiceError(
      `Leads module is not ready: table "leads" is missing column(s): ${missing.join(', ')}.` +
        ' On the server that uses this DATABASE_URL, run `npx prisma migrate deploy`, then restart the API.' +
        companyHint,
      503,
    );
  }

  leadsColumnCheckValidUntil = Date.now() + LEADS_COLUMN_CHECK_TTL_MS;
};

const assertModuleReady = async (): Promise<void> => {
  const leadTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  if (!leadTable[0]?.table_name) {
    throw createServiceError(
      'Leads module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }

  const leadStarTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'lead_stars'
  `;

  if (!leadStarTable[0]?.table_name) {
    throw createServiceError(
      'Lead stars module is not ready. Run Prisma migration/db push and restart backend.',
      503,
    );
  }

  await ensureLeadsColumnsMatchPrismaModel();

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Leads module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const resolveNextFollowUpType = (lead: LeadIncludeRecord): 'CALL' | 'VISIT' | 'MEETING' | null => {
  if (!lead.nextFollowUpAt) return null;
  const targetMs = lead.nextFollowUpAt.getTime();
  const match = lead.followUps.find(
    (item) => item.status === 'PENDING' && item.scheduledAt.getTime() === targetMs,
  );
  if (match?.type) {
    return normalizeFollowUpType(match.type);
  }
  return 'CALL';
};

const resolveFollowUpNote = (
  followUp?: {
    description?: string | null;
    completionDescription?: string | null;
    recentDescription?: string | null;
  } | null,
): string | null => {
  const completionDescription = followUp?.completionDescription?.trim();
  if (completionDescription) return completionDescription;
  const recentDescription = followUp?.recentDescription?.trim();
  if (recentDescription) return recentDescription;
  const description = followUp?.description?.trim();
  return description || null;
};

const resolveLatestFollowUpDescription = (lead: LeadIncludeRecord): string | null => {
  const latestWithNote = lead.followUps.find((item) => resolveFollowUpNote(item));
  return resolveFollowUpNote(latestWithNote);
};


const extractLastRemark = (lead: any): string | null => {
  let remarks: Array<{ text: string; date: number }> = [];

  if (lead.remarks) remarks.push({ text: lead.remarks, date: lead.updatedAt?.getTime() || 0 });
  
  if (lead.remarksList?.[0]?.text) {
    remarks.push({ text: lead.remarksList[0].text, date: lead.remarksList[0].createdAt.getTime() });
  }
  
  if (lead.lobLogs?.[0]) {
    const log = lead.lobLogs[0];
    const text = log.remarks || log.reason?.name || 'LOB Return';
    remarks.push({ text: `LOB Return: ${text}`, date: log.createdAt?.getTime() || log.changedAt?.getTime() || 0 });
  }
  


  if (lead.activities?.[0]) {
    const act = lead.activities[0];
    if (act.action === 'LEAD_REMARKS_CREATED' && act.metadata?.newRemarks) {
      remarks.push({ text: act.metadata.newRemarks, date: act.createdAt.getTime() });
    }
  }

  remarks.sort((a, b) => b.date - a.date);
  return remarks.length > 0 ? remarks[0].text : null;
};

const mapLeadRecord = (lead: LeadIncludeRecord) => {
  const advanceAmount = lead.advancePayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0;
  const totalAmount = Number(lead.totalAmount || 0);
  const balanceAmount = Math.max(0, totalAmount - advanceAmount);
  const expectedRevenue = lead.expectedRevenue !== null && lead.expectedRevenue !== undefined ? Number(lead.expectedRevenue) : balanceAmount;
  const lastRemark = extractLastRemark(lead);
  const { followUps, ...rest } = lead;
  return {
    ...rest,
    profileImageUrl: lead.profileImageUrl ?? null,
    profileImageThumbnail: lead.profileImageThumbnail ?? null,
    profileImageUploadedAt: lead.profileImageUploadedAt ? lead.profileImageUploadedAt.toISOString() : null,
    profileImageUploadedById: lead.profileImageUploadedById ?? null,
    advanceAmount,
    approvedAdvanceAmount: advanceAmount,
    balanceAmount,
    expectedRevenue,
    expectedRevenueContribution: expectedRevenue,
    lastRemark,
    nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null,
    nextFollowUpType: resolveNextFollowUpType(lead),
    stageEnteredAt: lead.stageEnteredAt ? lead.stageEnteredAt.toISOString() : null,
    stageExpiresAt: lead.stageExpiresAt ? lead.stageExpiresAt.toISOString() : null,
    pendingApprovalRequestedAt: lead.pendingApprovalRequestedAt ? lead.pendingApprovalRequestedAt.toISOString() : null,
    closedAt: lead.closedAt ? lead.closedAt.toISOString() : null,
    deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    followUpDescription: resolveLatestFollowUpDescription(lead),
  slaState: (() => {
    if (!lead.stageExpiresAt || !lead.slaAction || lead.isClosed || lead.isLOB) return null;
    const now = Date.now();
    const expiresAt = lead.stageExpiresAt.getTime();
    if (expiresAt <= now) return 'EXPIRED' as const;
    if (lead.slaWarningDays !== null && lead.slaWarningDays !== undefined) {
      const warningAt = expiresAt - lead.slaWarningDays * 24 * 60 * 60 * 1000;
      if (warningAt <= now) return 'WARNING' as const;
    }
    return 'ON_TRACK' as const;
  })(),
  assignedTo: lead.assignedTo
    ? {
        ...lead.assignedTo,
        displayName: resolveDisplayName(lead.assignedTo),
      }
    : null,
  createdBy: {
    ...lead.createdBy,
    displayName: resolveDisplayName(lead.createdBy),
  },
  closedBy: lead.closedBy
    ? {
        ...lead.closedBy,
        displayName: resolveDisplayName(lead.closedBy),
      }
    : null,
  lobLogs: ((lead as any).lobLogs || []).map((item: any) => ({
    ...item,
    changedAt: item.changedAt.toISOString(),
  })),
  products: ((lead as any).products || []).map((item: any) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  })),
  };
};

const normalizeLeadRemarks = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type LeadProductInput = { productId: string; quantity: number };
type LeadProductSnapshot = {
  productId: string;
  productName: string;
  productCode: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

type ProductSnapshotSource = {
  id: string;
  name: string;
  code: string | null;
  unitPrice: number;
};

const resolveLeadProductSnapshots = async (
  tx: any,
  workspaceId: string,
  products?: LeadProductInput[],
): Promise<LeadProductSnapshot[] | undefined> => {
  if (products === undefined) return undefined;
  if (products.length === 0) return [];

  const normalized = products.map((item) => ({
    productId: item.productId.trim(),
    quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
  }));
  const ids = Array.from(new Set(normalized.map((item) => item.productId)));
  const productRows = await tx.product.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      code: true,
      unitPrice: true,
    },
  });
  const productById = new Map<string, ProductSnapshotSource>(
    productRows.map((item: ProductSnapshotSource) => [item.id, item]),
  );

  return normalized.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw createServiceError('One or more selected products are inactive or unavailable.', 422);
    }
    const unitPrice = Number(product.unitPrice || 0);
    const lineTotal = unitPrice * item.quantity;
    return {
      productId: product.id,
      productName: product.name,
      productCode: product.code || null,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
    };
  });
};

const sumProductSnapshots = (snapshots?: LeadProductSnapshot[]): number | undefined => {
  if (snapshots === undefined) return undefined;
  return snapshots.reduce((sum, item) => sum + item.lineTotal, 0);
};

const replaceLeadProducts = async (
  tx: any,
  workspaceId: string,
  leadId: string,
  actorId: string,
  snapshots: LeadProductSnapshot[],
): Promise<void> => {
  const previous = await tx.leadProduct.findMany({
    where: { workspaceId, leadId },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
    },
  });

  await tx.leadProduct.deleteMany({ where: { workspaceId, leadId } });
  if (snapshots.length > 0) {
    await tx.leadProduct.createMany({
      data: snapshots.map((item) => ({
        workspaceId,
        leadId,
        productId: item.productId,
        productName: item.productName,
        productCode: item.productCode,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        createdById: actorId,
      })),
    });
  }

  await tx.leadActivity.create({
    data: {
      leadId,
      performedById: actorId,
      workspaceId,
      action: 'LEAD_PRODUCTS_UPDATED',
      metadata: { previous, next: snapshots },
    },
  });

  await tx.auditLog.create({
    data: {
      userId: actorId,
      workspaceId,
      action: 'LEAD_PRODUCTS_UPDATED',
      entityType: 'Lead',
      entityId: leadId,
      details: { previous, next: snapshots },
    },
  });
};

const resolveLobRemarks = (
  input: { remarks?: string | null; lobRemarks?: string | null },
  stage: { isLOB: boolean; name: string } | null,
): string | null => {
  const explicit = normalizeLeadRemarks(input.lobRemarks);
  if (explicit !== undefined) return explicit;

  // Backward compatibility for older clients that used `remarks` as the LOB context.
  if (stage?.isLOB || normalizeRoleKey(stage?.name) === 'lob') {
    return normalizeLeadRemarks(input.remarks) ?? null;
  }

  return null;
};

const buildRemarksAuditAction = (previousRemarks: string | null, nextRemarks: string | null): string | null => {
  if (previousRemarks === nextRemarks) return null;
  if (!previousRemarks && nextRemarks) return 'LEAD_REMARKS_CREATED';
  if (previousRemarks && !nextRemarks) return 'LEAD_REMARKS_REMOVED';
  return 'LEAD_REMARKS_UPDATED';
};

type LeadDynamicValueInput = { fieldId: string; value?: string };

type LeadDynamicValueRecord = {
  id: string;
  leadId: string;
  fieldId: string;
  value: string;
  createdAt: Date;
  field: {
    id: string;
    name: string;
    inputType: string;
    sortOrder: number;
  };
};

const OPTION_DYNAMIC_INPUT_TYPES = new Set(['SELECT', 'RADIO', 'CHECKBOX']);

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeDynamicValueEntries = (entries?: LeadDynamicValueInput[]): LeadDynamicValueInput[] => {
  const ordered = new Map<string, LeadDynamicValueInput>();
  for (const entry of entries || []) {
    const fieldId = entry?.fieldId?.trim();
    if (!fieldId) continue;
    ordered.set(fieldId, {
      fieldId,
      value: typeof entry.value === 'string' ? entry.value.trim() : '',
    });
  }
  return Array.from(ordered.values());
};

const getActiveDynamicFields = async (tx: any, workspaceId: string) =>
  (tx as any).leadDynamicField.findMany({
    where: { workspaceId, isActive: true },
    include: {
      options: {
        orderBy: { sortOrder: 'asc' },
        select: { value: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

const splitDynamicOptionValue = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const validateDynamicValueForField = (field: any, value: string): void => {
  if (!value) return;

  if (field.inputType === 'FILE' && !isHttpUrl(value)) {
    throw createServiceError(`"${field.name}" must be a valid HTTP/HTTPS file URL.`, 422);
  }

  if (!OPTION_DYNAMIC_INPUT_TYPES.has(field.inputType)) {
    return;
  }

  const allowed = new Set((field.options || []).map((option: { value: string }) => option.value));
  const submittedValues = field.inputType === 'CHECKBOX' ? splitDynamicOptionValue(value) : [value];
  const invalidValue = submittedValues.find((item) => !allowed.has(item));
  if (invalidValue) {
    throw createServiceError(`"${invalidValue}" is not a valid option for "${field.name}".`, 422);
  }
};

const validateLeadDynamicValues = async (
  tx: any,
  workspaceId: string,
  entries?: LeadDynamicValueInput[],
  options?: { requireAllRequired?: boolean },
): Promise<Array<{ fieldId: string; value: string; field: any }>> => {
  const normalized = normalizeDynamicValueEntries(entries);
  if (!normalized.length && !options?.requireAllRequired) return [];

  const activeFields = await getActiveDynamicFields(tx, workspaceId);
  const fieldById = new Map(activeFields.map((field: any) => [field.id, field]));
  const valueByFieldId = new Map(normalized.map((entry) => [entry.fieldId, entry.value || '']));

  for (const entry of normalized) {
    const field = fieldById.get(entry.fieldId);
    if (!field) {
      throw createServiceError('One or more dynamic fields are no longer active for this workspace.', 422);
    }
    validateDynamicValueForField(field, entry.value || '');
  }

  for (const field of activeFields) {
    if (!field.isRequired) continue;
    if (!options?.requireAllRequired && !valueByFieldId.has(field.id)) continue;
    const value = valueByFieldId.get(field.id) || '';
    if (!value.trim()) {
      throw createServiceError(`"${field.name}" is required.`, 422);
    }
  }

  return normalized.map((entry) => ({
    fieldId: entry.fieldId,
    value: entry.value || '',
    field: fieldById.get(entry.fieldId),
  }));
};

const persistLeadDynamicValues = async (
  tx: any,
  workspaceId: string,
  leadId: string,
  entries: LeadDynamicValueInput[] | undefined,
  actorId: string,
  options?: { requireAllRequired?: boolean },
): Promise<void> => {
  const prepared = await validateLeadDynamicValues(tx, workspaceId, entries, options);
  if (!prepared.length) return;

  const fieldIds = prepared.map((entry) => entry.fieldId);
  const previousRows = await (tx as any).leadDynamicValue.findMany({
    where: { leadId, fieldId: { in: fieldIds } },
    select: { fieldId: true, value: true },
  });
  const previousByFieldId = new Map(previousRows.map((row: { fieldId: string; value: string }) => [row.fieldId, row.value]));

  await (tx as any).leadDynamicValue.deleteMany({
    where: { leadId, fieldId: { in: fieldIds } },
  });

  const rows = prepared
    .filter((entry) => entry.value.trim().length > 0)
    .map((entry) => ({
      leadId,
      fieldId: entry.fieldId,
      value: entry.value.trim(),
    }));

  if (rows.length > 0) {
    await (tx as any).leadDynamicValue.createMany({ data: rows });
  }

  for (const entry of prepared) {
    const previousValue = previousByFieldId.get(entry.fieldId) || '';
    const nextValue = entry.value.trim();
    if (previousValue === nextValue) continue;
    await (tx as any).auditLog.create({
      data: {
        userId: actorId,
        workspaceId,
        action: previousValue && !nextValue ? 'LEAD_DYNAMIC_FIELD_REMOVED' : previousValue ? 'LEAD_DYNAMIC_FIELD_UPDATED' : 'LEAD_DYNAMIC_FIELD_CREATED',
        entityType: 'Lead',
        entityId: leadId,
        details: {
          fieldId: entry.fieldId,
          fieldName: entry.field?.name,
          previousValue: previousValue || null,
          newValue: nextValue || null,
          changedBy: actorId,
        },
      },
    });
  }
};

const fetchLeadDynamicValueMap = async (leadIds: string[]): Promise<Map<string, LeadDynamicValueRecord[]>> => {
  const map = new Map<string, LeadDynamicValueRecord[]>();
  if (leadIds.length === 0) return map;

  const rows = (await (prisma as any).leadDynamicValue.findMany({
    where: { leadId: { in: leadIds } },
    include: {
      field: {
        select: {
          id: true,
          name: true,
          inputType: true,
          sortOrder: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  })) as LeadDynamicValueRecord[];

  rows.sort(
    (left, right) =>
      (left.field?.sortOrder ?? 0) - (right.field?.sortOrder ?? 0) ||
      left.createdAt.getTime() - right.createdAt.getTime(),
  );

  for (const row of rows) {
    const values = map.get(row.leadId) || [];
    values.push(row);
    map.set(row.leadId, values);
  }

  return map;
};

const serializeLeadDynamicValues = (values?: LeadDynamicValueRecord[]) =>
  (values || []).map((item) => ({
    id: item.id,
    leadId: item.leadId,
    fieldId: item.fieldId,
    value: item.value,
    createdAt: item.createdAt.toISOString(),
    field: item.field,
  }));

const mapLeadRecordWithDynamicValues = (
  lead: LeadIncludeRecord,
  dynamicValueMap: Map<string, LeadDynamicValueRecord[]>,
  starredLeadIds?: Set<string>,
) => ({
  ...mapLeadRecord(lead),
  dynamicValues: serializeLeadDynamicValues(dynamicValueMap.get(lead.id)),
  isStarred: starredLeadIds?.has(lead.id) ?? false,
});

const calculateExpectedRevenueForWhere = async (where: any): Promise<number> => {
  const rows = await (prisma as any).lead.findMany({
    where: {
      ...where,
      isLOB: false,
    },
    select: {
      id: true,
      totalAmount: true,
    },
  });

  if (rows.length === 0) return 0;

  const leadIds = rows.map((lead: any) => lead.id);
  const advanceGroups = await (prisma as any).advancePayment.groupBy({
    by: ['leadId'],
    where: {
      leadId: { in: leadIds },
      status: 'APPROVED',
    },
    _sum: { amount: true },
  });
  const approvedByLead = new Map<string, number>(
    advanceGroups.map((item: any) => [item.leadId, Number(item._sum?.amount || 0)]),
  );

  return rows.reduce((sum: number, lead: any) => {
    const totalAmount = Number(lead.totalAmount || 0);
    const approved = approvedByLead.get(lead.id) || 0;
    return sum + Math.max(0, totalAmount - approved);
  }, 0);
};

const fetchStarredLeadIds = async (
  workspaceId: string,
  userId: string | undefined,
  leadIds: string[],
): Promise<Set<string>> => {
  if (!userId || leadIds.length === 0) return new Set();

  const rows = await (prisma as any).leadStar.findMany({
    where: {
      workspaceId,
      userId,
      leadId: { in: leadIds },
      isStarred: true,
    },
    select: { leadId: true },
  });

  return new Set(rows.map((row: { leadId: string }) => row.leadId));
};

const findStarredLeadIdsForUser = async (workspaceId: string, userId: string): Promise<string[]> => {
  const rows = await (prisma as any).leadStar.findMany({
    where: {
      workspaceId,
      userId,
      isStarred: true,
    },
    select: { leadId: true },
  });

  return rows.map((row: { leadId: string }) => row.leadId);
};

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildLeadCacheKey = (workspaceId: string, query: ListLeadsQueryInput | ExportLeadsQueryInput, actor?: Actor): string =>
  `leads:${workspaceId}:${actor ? `${actor.id}:${actor.roleId ?? 'no-role'}:` : ''}${JSON.stringify(query)}`;

const isLeadVisibilityDebugEnabled = (): boolean => process.env.LEAD_VISIBILITY_DEBUG === 'true';

const logLeadVisibilityDebug = async ({
  workspaceId,
  actor,
  query,
  filteredTotal,
  responseCount,
}: {
  workspaceId: string;
  actor?: Actor;
  query: ListLeadsQueryInput;
  filteredTotal: number;
  responseCount: number;
}): Promise<void> => {
  if (!isLeadVisibilityDebugEnabled()) return;

  let scope = 'anonymous';
  let permissionScopedTotal = 0;
  const workspaceTotal = await (prisma as any).lead.count({
    where: {
      workspaceId,
      deletedAt: null,
    },
  });

  if (actor) {
    try {
      scope = await resolveLeadVisibilityMode(workspaceId, actor);
      const accessWhere = await buildAccessWhere(workspaceId, actor);
      permissionScopedTotal = await (prisma as any).lead.count({
        where: {
          workspaceId,
          deletedAt: null,
          ...(Object.keys(accessWhere).length > 0 ? { AND: [accessWhere] } : {}),
        },
      });
    } catch {
      scope = 'none';
      permissionScopedTotal = 0;
    }
  } else {
    scope = 'all';
    permissionScopedTotal = workspaceTotal;
  }

  logger.info('Lead visibility debug snapshot', {
    action: 'lead_visibility_debug',
    workspaceId,
    actorId: actor?.id,
    roleId: actor?.roleId,
    scope,
    workspaceTotal,
    permissionScopedTotal,
    filteredTotal,
    responseCount,
    query,
  });
};

export const clearLeadCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isOpen) return;

  try {
    const keysToDelete: string[] = [];
    const pattern = `leads:${workspaceId}:*`;

    // Try scan iterator first (best for perf)
    for await (const key of (redisClient as any).scanIterator({ MATCH: pattern, COUNT: 250 })) {
      if (typeof key === 'string' && key.length > 0) {
        keysToDelete.push(key);
      }
    }

    // Fallback search if scan found nothing but we expect keys
    if (keysToDelete.length === 0) {
      const keys = await (redisClient as any).keys(pattern);
      if (Array.isArray(keys)) {
        keys.forEach(k => {
          if (typeof k === 'string' && k.length > 0) keysToDelete.push(k);
        });
      }
    }

    if (keysToDelete.length > 0) {
      const uniqueKeysFinal = Array.from(new Set(keysToDelete));
      // Process in batches of 50 to avoid blocking Redis or hitting payload limits
      for (let i = 0; i < uniqueKeysFinal.length; i += 50) {
        const batch = uniqueKeysFinal.slice(i, i + 50);
        await redisClient.del(batch);
      }
    }
    
    // Tiny delay to allow Redis deletions to fully propagate
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (error) {
    console.error('Failed to clear lead cache:', error);
  }
};

const ensureFutureFollowUp = (date?: Date | null): void => {
  if (!date) return;
  if (date.getTime() <= Date.now()) {
    throw createServiceError('nextFollowUpAt must be a future date.', 422);
  }
};

const ensureUserExistsInWorkspace = async (workspaceId: string, userId: string): Promise<void> => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  if (!user) {
    throw createServiceError('Assigned user was not found in this workspace.', 404);
  }
};

const actorCanAssignToOthers = async (actor: Actor): Promise<boolean> =>
  hasPermission(actor, 'LEADS_ASSIGN');

const ensureAssignmentAllowed = async (
  actor: Actor,
  assignedToId: string | null | undefined,
): Promise<void> => {
  if (!assignedToId || assignedToId === actor.id) return;
  const canAssign = await actorCanAssignToOthers(actor);
  if (!canAssign) {
    throw createServiceError('You are not allowed to assign a lead to another user.', 403);
  }
};

const ensureAssignmentUpdateAllowed = async (
  actor: Actor,
  currentAssignedToId: string | null | undefined,
  nextAssignedToId: string | null | undefined,
): Promise<void> => {
  const current = currentAssignedToId ?? null;
  const next = nextAssignedToId ?? null;

  if (current === next) return;
  if (next === actor.id) return;

  const canAssign = await actorCanAssignToOthers(actor);
  if (!canAssign) {
    throw createServiceError('You are not allowed to change the lead owner.', 403);
  }
};

const resolveCreateAssignedToId = async (
  workspaceId: string,
  actor: Actor,
  inputAssignedToId: string | null | undefined,
): Promise<{ assignedToId: string | null; autoSelfAssigned: boolean }> => {
  const canAssignToOthers = await actorCanAssignToOthers(actor);

  if (!canAssignToOthers) {
    if (inputAssignedToId && inputAssignedToId !== actor.id) {
      throw createServiceError('You are not allowed to assign a lead to another user.', 403);
    }
    await ensureUserExistsInWorkspace(workspaceId, actor.id);
    return { assignedToId: actor.id, autoSelfAssigned: true };
  }

  await ensureAssignmentAllowed(actor, inputAssignedToId);
  const assignedToId = await resolveAssignedUserId(workspaceId, inputAssignedToId);
  return { assignedToId, autoSelfAssigned: false };
};

const resolveAssignedUserId = async (
  workspaceId: string,
  assignedToId: string | null | undefined,
): Promise<string | null> => {
  if (!assignedToId) return null;
  await ensureUserExistsInWorkspace(workspaceId, assignedToId);
  return assignedToId;
};

const resolveStage = async (workspaceId: string, stageId: string | null | undefined) => {
  if (!stageId) return null;

  const stage = await prisma.leadStage.findFirst({
    where: {
      id: stageId,
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
    },
  });

  if (!stage) {
    throw createServiceError('Lead stage was not found.', 404);
  }

  return stage;
};

const resolveLifecycle = async (workspaceId: string, lifecycleId?: string | null) => {
  if (!lifecycleId) {
    // Lifecycle is opt-in per lead; do not auto-attach workspace default.
    return null;
  }

  const lifecycle = await prisma.leadLifeCycle.findFirst({
    where: {
      id: lifecycleId,
      workspaceId,
    },
    select: {
      id: true,
      name: true,
      transitions: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          fromStageId: true,
          numberOfDays: true,
          expiryAction: true,
          warningDays: true,
        },
      },
    },
  });

  if (!lifecycle) {
    throw createServiceError('Lead lifecycle was not found in this workspace.', 404);
  }

  return lifecycle;
};

const emptySlaSnapshot = (): LeadSlaSnapshot => ({
  stageEnteredAt: null,
  stageExpiresAt: null,
  slaAction: null,
  slaWarningDays: null,
});

const addDays = (base: Date, days: number): Date => new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

const resolveLifecycleTransition = (
  lifecycle?:
    | {
        transitions?: Array<{
          numberOfDays: number;
          expiryAction: SlaAction;
          warningDays: number;
          fromStageId?: string | null;
        }>;
      }
    | null,
  stageId?: string | null,
): {
  numberOfDays: number;
  expiryAction: SlaAction;
  warningDays: number;
} | null => {
  const transitions = lifecycle?.transitions || [];
  if (transitions.length === 0 || !stageId) return null;
  const transition = transitions.find((item) => item.fromStageId === stageId);
  if (!transition || transition.numberOfDays <= 0) return null;

  return {
    numberOfDays: transition.numberOfDays,
    expiryAction: transition.expiryAction || 'AUTO_LOB',
    warningDays: transition.warningDays ?? 0,
  };
};

const buildLeadSlaSnapshot = async (
  lifecycle?:
    | {
        transitions?: Array<{
          fromStageId?: string | null;
          numberOfDays: number;
          expiryAction: SlaAction;
          warningDays: number;
        }>;
      }
    | null,
  stageId?: string | null,
  fromDate = new Date(),
): Promise<LeadSlaSnapshot> => {
  const transition = resolveLifecycleTransition(lifecycle, stageId);
  if (!transition) return emptySlaSnapshot();

  return {
    stageEnteredAt: fromDate,
    stageExpiresAt: addDays(fromDate, transition.numberOfDays),
    slaAction: transition.expiryAction,
    slaWarningDays: transition.warningDays,
  };
};

const shouldRefreshSla = (
  existing: Pick<LeadIncludeRecord, 'stageId' | 'lifecycleId'>,
  nextStageId?: string | null,
  nextLifecycleId?: string | null,
): boolean => existing.stageId !== (nextStageId ?? null) || existing.lifecycleId !== (nextLifecycleId ?? null);

const shouldRequireApprovalForStage = (
  stage?: { isApprovalRequired?: boolean | null; isClosed?: boolean | null; name?: string | null } | null,
): boolean => Boolean(stage?.isApprovalRequired);

const sweepThrottleByWorkspace = new Map<string, number>();

const shouldRunSweepNow = (workspaceId: string): boolean => {
  const now = Date.now();
  const lastRunAt = sweepThrottleByWorkspace.get(workspaceId) || 0;
  if (now - lastRunAt < LEADS_CACHE_TTL_SECONDS * 1000) return false;
  sweepThrottleByWorkspace.set(workspaceId, now);
  return true;
};

const getLobStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ isLOB: true }, { name: { equals: 'LOB'} }],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      isLOB: true,
      isClosed: true,
    },
  });

const getDefaultStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      isLOB: false,
      isClosed: false,
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
    },
  });

const getNewStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      isLOB: false,
      isClosed: false,
      OR: [
        { name: { equals: 'new'} },
        { name: { equals: 'new lead'} },
      ],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
    },
  });

const maybeRunLeadSlaSweep = async (workspaceId: string | null | undefined): Promise<void> => {
  if (!workspaceId?.trim()) {
    logger.warn('Skipping lead SLA sweep because workspaceId is missing.', {
      action: 'lead_sla_sweep_skipped',
    });
    return;
  }

  if (!shouldRunSweepNow(workspaceId)) return;

  try {
    const expiredAutoLobLeads = await prisma.lead.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        isClosed: false,
        isLOB: false,
        stageExpiresAt: { lte: new Date() },
        slaAction: 'AUTO_LOB',
      },
      select: {
        id: true,
        stageId: true,
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: 100,
    });

    if (expiredAutoLobLeads.length === 0) return;

    const lobStage = await getLobStageForWorkspace(workspaceId);
    if (!lobStage) return;

    for (const lead of expiredAutoLobLeads) {
      const now = new Date();
      await prisma.$transaction(async (tx: any) => {
        await (tx as any).lead.update({
          where: { id: lead.id },
          data: {
            stageId: lobStage.id,
            isLOB: true,
            isClosed: false,
            closedAt: now,
            closureType: 'LOST',
            stageEnteredAt: now,
            stageExpiresAt: null,
            slaAction: null,
            slaWarningDays: null,
          },
        });

        await (tx as any).leadLOBLog.create({
          data: {
            leadId: lead.id,
            reasonId: 'SYSTEM_SLA_EXPIRED',
            remarks: 'Moved automatically to LOB after stage SLA expired.',
            previousStageId: lead.stageId,
            previousStageName: lead.stage?.name?.trim() || null,
            changedById: 'system',
            workspaceId,
          },
        });
      });
    }

    await clearLeadCache(workspaceId);
  } catch (error: any) {
    sweepThrottleByWorkspace.delete(workspaceId);
    logger.error('Lead SLA sweep failed; continuing without blocking lead reads.', {
      action: 'lead_sla_sweep_failed',
      workspaceId,
      error: error?.message,
    });
  }
};

const resolveSource = async (workspaceId: string, sourceId: string | null | undefined) => {
  if (!sourceId) return null;

  const source = await prisma.leadSource.findFirst({
    where: {
      id: sourceId,
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!source) {
    throw createServiceError('Lead source was not found.', 404);
  }

  return source;
};

const normalizeRuleFieldKey = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const stageRuleValuesToAnswerMap = (
  entries?: Array<{ ruleId: string; value: string }>,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const entry of entries || []) {
    if (!entry?.ruleId?.trim()) continue;
    map[entry.ruleId.trim()] = typeof entry.value === 'string' ? entry.value : '';
  }
  return map;
};

const persistLeadStageRuleValues = async (
  leadId: string,
  entries?: Array<{ ruleId: string; value: string }>,
): Promise<void> => {
  if (!entries?.length) return;
  const rows = entries
    .filter((entry) => entry.ruleId?.trim() && entry.value?.trim())
    .map((entry) => ({
      leadId,
      ruleId: entry.ruleId.trim(),
      value: entry.value.trim(),
    }));
  if (!rows.length) return;
  await (prisma as any).leadStageInput.createMany({ data: rows });
};

type StageValidationPatch = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  address?: string | null;
  expectedRevenue?: number | null;
  assignedToId?: string | null;
  sourceId?: string | null;
  lifecycleId?: string | null;
  nextFollowUpAt?: Date | null;
  followUpDescription?: string | null;
  reasonId?: string | null;
  remarks?: string | null;
  lobRemarks?: string | null;
  stageId?: string | null;
  dynamicValues?: LeadDynamicValueInput[];
};

const toValidationLeadData = async (
  lead: LeadIncludeRecord,
  patch: StageValidationPatch,
): Promise<Record<string, unknown>> => {
  const dynamicValues = await (prisma as any).leadDynamicValue.findMany({
    where: { leadId: lead.id },
    select: {
      value: true,
      field: {
        select: {
          name: true,
        },
      },
    },
  });

  const data: Record<string, unknown> = {
    name: patch.name ?? lead.name,
    email: patch.email !== undefined ? patch.email : lead.email,
    phone: patch.phone !== undefined ? patch.phone : lead.phone,
    companyName: patch.companyName !== undefined ? patch.companyName : lead.companyName,
    address: patch.address !== undefined ? patch.address : lead.address,
    expectedRevenue: patch.expectedRevenue !== undefined ? patch.expectedRevenue : lead.expectedRevenue,
    assignedToId: patch.assignedToId !== undefined ? patch.assignedToId : lead.assignedToId,
    sourceId: patch.sourceId !== undefined ? patch.sourceId : lead.sourceId,
    lifecycleId: patch.lifecycleId !== undefined ? patch.lifecycleId : lead.lifecycleId,
    nextFollowUpAt: patch.nextFollowUpAt !== undefined ? patch.nextFollowUpAt : lead.nextFollowUpAt,
    followUpDescription: patch.followUpDescription ?? undefined,
    reasonId: patch.reasonId !== undefined ? patch.reasonId : undefined,
    remarks: patch.remarks !== undefined ? patch.remarks : undefined,
  };

  Object.entries(data).forEach(([key, value]) => {
    data[normalizeRuleFieldKey(key)] = value;
  });

  for (const entry of dynamicValues) {
    const fieldName = entry?.field?.name?.trim();
    if (!fieldName) continue;
    data[fieldName] = entry.value;
    data[normalizeRuleFieldKey(fieldName)] = entry.value;
  }

  if (patch.dynamicValues?.length) {
    const submittedFieldIds = patch.dynamicValues
      .map((entry) => entry.fieldId?.trim())
      .filter(Boolean);
    const submittedFields = await (prisma as any).leadDynamicField.findMany({
      where: { id: { in: submittedFieldIds }, workspaceId: lead.workspaceId, isActive: true },
      select: { id: true, name: true },
    }) as Array<{ id: string; name: string }>;
    const fieldById = new Map(submittedFields.map((field: { id: string; name: string }) => [field.id, field]));
    for (const entry of patch.dynamicValues) {
      const field = fieldById.get(entry.fieldId);
      const fieldName = field?.name?.trim();
      if (!fieldName) continue;
      const value = typeof entry.value === 'string' ? entry.value.trim() : '';
      data[fieldName] = value;
      data[normalizeRuleFieldKey(fieldName)] = value;
    }
  }

  return data;
};

const ensureLOBPayload = (stage: { isLOB: boolean; name: string } | null, reasonId?: string | null, remarks?: string | null): void => {
  const isLobStage = Boolean(stage?.isLOB || normalizeRoleKey(stage?.name) === 'lob');
  if (!isLobStage) return;

  if (!reasonId) {
    throw createServiceError('reasonId is required when moving a lead to LOB.', 422);
  }
};

const ensureValidLOBReasonForStage = async (
  workspaceId: string,
  stage: { isLOB: boolean; name: string } | null,
  reasonId?: string | null,
): Promise<void> => {
  const isLobStage = Boolean(stage?.isLOB || normalizeRoleKey(stage?.name) === 'lob');
  if (!isLobStage || !reasonId) return;

  await assertActiveLOBReason(workspaceId, reasonId);
};

const findDuplicateLead = async (
  workspaceId: string,
  email?: string | null,
  phone?: string | null,
  excludeId?: string,
): Promise<void> => {
  const normalizedEmail = email?.trim() || null;
  const normalizedPhone = phone?.trim() || null;
  const filters = [];
  if (normalizedEmail) filters.push({ email: normalizedEmail });
  if (normalizedPhone) filters.push({ phone: normalizedPhone });
  if (filters.length === 0) return;

  const duplicate = await (prisma as any).lead.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: filters,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (duplicate) {
    const conflicts: string[] = [];
    if (normalizedEmail && duplicate.email?.trim().toLowerCase() === normalizedEmail.toLowerCase()) {
      conflicts.push(`email "${normalizedEmail}"`);
    }
    if (normalizedPhone && duplicate.phone?.trim() === normalizedPhone) {
      conflicts.push(`phone "${normalizedPhone}"`);
    }

    const duplicateLabel = duplicate.name?.trim() || 'another lead';
    const conflictSummary = conflicts.length > 0 ? conflicts.join(' and ') : 'the same email or phone';
    throw createServiceError(
      `A lead already exists with ${conflictSummary}. Please review "${duplicateLabel}" or use different contact details.`,
      409,
    );
  }
};

const buildListWhere = async (
  workspaceId: string,
  query: ListLeadsQueryInput | ExportLeadsQueryInput,
  actor?: Actor,
  options?: { includeArchived?: boolean },
) => {
  const where: any = {
    workspaceId,
  };

  if (actor) {
    const accessWhere = await buildAccessWhere(workspaceId, actor);
    if (accessWhere && Object.keys(accessWhere).length > 0) {
      where.AND = [accessWhere];
    }
  }

  if (query.starred === 'STARRED') {
    if (!actor?.id) {
      where.id = { in: [] };
    } else {
      const starredLeadIds = await findStarredLeadIdsForUser(workspaceId, actor.id);
      where.id = { in: starredLeadIds };
    }
  }

  const includeArchived = Boolean(options?.includeArchived);

  if (!includeArchived) {
    if (query.status === 'ARCHIVED') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
  } else if (query.status === 'ARCHIVED') {
    where.deletedAt = { not: null };
  }

  if (query.search) {
    const dynamicMatches = await (prisma as any).leadDynamicValue.findMany({
      where: {
        value: { contains: query.search, mode: 'insensitive' },
        field: { workspaceId, isActive: true },
      },
      select: { leadId: true },
      take: 1000,
    });
    const dynamicLeadIds = Array.from(new Set(dynamicMatches.map((item: { leadId: string }) => item.leadId)));
    const searchCond = {
      OR: [
        { name: { contains: query.search, mode: 'insensitive'} },
        { email: { contains: query.search, mode: 'insensitive'} },
        { phone: { contains: query.search, mode: 'insensitive'} },
        { companyName: { contains: query.search, mode: 'insensitive'} },

        { remarks: { contains: query.search, mode: 'insensitive'} },
        { remarksList: { some: { text: { contains: query.search, mode: 'insensitive' } } } },
        { lobLogs: { some: { OR: [ { remarks: { contains: query.search, mode: 'insensitive' } }, { reason: { name: { contains: query.search, mode: 'insensitive' } } } ] } } },


        { assignedTo: { name: { contains: query.search, mode: 'insensitive'} } },
        { source: { name: { contains: query.search, mode: 'insensitive'} } },
        { stage: { name: { contains: query.search, mode: 'insensitive'} } },
        ...(dynamicLeadIds.length > 0 ? [{ id: { in: dynamicLeadIds } }] : []),
      ],
    };
    if (where.AND) {
      where.AND.push(searchCond);
    } else {
      where.AND = [searchCond];
    }
  }

  if (query.assignedTo) where.assignedToId = query.assignedTo;
  if (query.stage) where.stageId = query.stage;
  if (query.source) where.sourceId = query.source;

  if ('officeId' in query && query.officeId) {
    if (where.AND) {
      where.AND.push({ assignedTo: { officeId: query.officeId } });
    } else {
      where.AND = [{ assignedTo: { officeId: query.officeId } }];
    }
  }

  if (query.status === 'OPEN') {
    where.isClosed = false;
  } else if (query.status === 'CLOSED') {
    where.isClosed = true;
    where.isLOB = false;
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        NOT: {
          stage: {
            is: {
              isLOB: true,
            },
          },
        },
      },
    ];
  } else  if (query.status === 'LOB') {
    where.isLOB = true;
  } else if (query.status === 'ACTIVE') {
    where.isClosed = false;
    where.isLOB = false;
  }

  // Date Range Filtering for Created Date (createdFrom / createdTo / dateFrom / dateTo)
  const qAny = query as Record<string, any>;
  const createdFromVal = qAny.createdFrom || qAny.created_date_from || qAny.dateFrom;
  const createdToVal = qAny.createdTo || qAny.created_date_to || qAny.dateTo;
  if (createdFromVal || createdToVal) {
    const createdAtFilter: any = {};
    if (createdFromVal) {
      const fromDate = new Date(createdFromVal);
      fromDate.setHours(0, 0, 0, 0);
      createdAtFilter.gte = fromDate;
    }
    if (createdToVal) {
      const toDate = new Date(createdToVal);
      toDate.setHours(23, 59, 59, 999);
      createdAtFilter.lte = toDate;
    }
    where.createdAt = createdAtFilter;
  }

  // Date Range Filtering for Next Follow-up Date (followupFrom / followupTo)
  const followupFromVal = qAny.followupFrom || qAny.followup_date_from;
  const followupToVal = qAny.followupTo || qAny.followup_date_to;
  if (followupFromVal || followupToVal) {
    const followupFilter: any = {};
    if (followupFromVal) {
      const fromDate = new Date(followupFromVal);
      fromDate.setHours(0, 0, 0, 0);
      followupFilter.gte = fromDate;
    }
    if (followupToVal) {
      const toDate = new Date(followupToVal);
      toDate.setHours(23, 59, 59, 999);
      followupFilter.lte = toDate;
    }
    where.nextFollowUpAt = followupFilter;
  }

  return where;
};

const getLeadScoped = async (workspaceId: string, id: string, actor?: Actor) => {
  const where: any = {
    id,
    workspaceId,
    deletedAt: null,
  };

  if (actor) {
    const accessWhere = await buildAccessWhere(workspaceId, actor);
    if (accessWhere && Object.keys(accessWhere).length > 0) {
      where.AND = [accessWhere];
    }
  }

  const includeProfileImageColumns = await areLeadProfileImageColumnsReady();
  const lead = await (prisma as any).lead.findFirst({
    where,
    select: buildLeadSelect(includeProfileImageColumns),
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  return lead as LeadIncludeRecord;
};

const createAutomaticFollowUp = async (
  tx: any,
  leadId: string,
  workspaceId: string,
  userId: string,
  scheduledAt: Date,
  description?: string,
  followUpType: 'CALL' | 'VISIT' | 'MEETING' = 'CALL',
): Promise<void> => {
  const existingPending = await (tx as any).followUp.findFirst({
    where: { leadId, workspaceId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });

  if (existingPending) {
    await (tx as any).followUp.update({
      where: { id: existingPending.id },
      data: {
        userId,
        type: followUpType,
        description: description?.trim() || existingPending.description,
        scheduledAt,
      },
    });
  } else {
    await (tx as any).followUp.create({
      data: {
        leadId,
        userId,
        workspaceId,
        type: followUpType,
        description: description?.trim() || 'Auto-created from lead workflow',
        status: 'PENDING',
        scheduledAt,
      },
    });
  }
};

export const createLead = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLeadInput,
): Promise<{ lead: ReturnType<typeof mapLeadRecord>; autoSelfAssigned: boolean }> => {
  await assertModuleReady();
  logger.info('[Diagnostic] Lead creation started', { workspaceId, actorId: actor.id, inputName: input.name });
  ensureFutureFollowUp(input.nextFollowUpAt);

  await findDuplicateLead(workspaceId, input.email ?? null, input.phone ?? null);
  logger.info('[Diagnostic] Lead validation completed', { email: input.email, phone: input.phone });

  const { assignedToId, autoSelfAssigned } = await resolveCreateAssignedToId(
    workspaceId,
    actor,
    input.assignedToId,
  );
  const followUpOwnerId = assignedToId || actor.id;
  const shouldAutoAssignStage = !input.skipAutoStageAssignment || Boolean(input.stageId);
  const stage = shouldAutoAssignStage
    ? (await resolveStage(workspaceId, input.stageId)) ||
      (await getNewStageForWorkspace(workspaceId)) ||
      (await getDefaultStageForWorkspace(workspaceId)) ||
      null
    : null;
  const lifecycle = await resolveLifecycle(workspaceId, input.lifecycleId);
  const source = await resolveSource(workspaceId, input.sourceId);
  const leadRemarks = normalizeLeadRemarks(input.remarks) ?? null;
  const lobRemarks = resolveLobRemarks(input, stage);
  ensureLOBPayload(stage, input.reasonId, lobRemarks);
  await ensureValidLOBReasonForStage(workspaceId, stage, input.reasonId);
  const slaSnapshot = isLobStage(stage) || isClosedWonStage(stage)
    ? emptySlaSnapshot()
    : await buildLeadSlaSnapshot(lifecycle, stage?.id || null);

  try {
    const includeProfileImageColumns = await areLeadProfileImageColumnsReady();
    const createdLeadId = await prisma.$transaction(async (tx: any) => {
      const productSnapshots = await resolveLeadProductSnapshots(tx, workspaceId, (input as any).products);
      const productTotal = sumProductSnapshots(productSnapshots);
      const resolvedTotalAmount =
        input.totalAmount !== undefined && input.totalAmount !== null
          ? Number(input.totalAmount)
          : productTotal !== undefined
            ? productTotal
            : 0;
      const outcomeFlags = stage
        ? buildLeadOutcomeFlagsFromStage(stage, actor.id)
        : buildClosureUpdateData(stage, actor.id);

      const lead = await (tx as any).lead.create({
        data: {
          name: input.name.trim(),
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          companyName: input.companyName?.trim() || null,
          address: input.address?.trim() || null,
          remarks: leadRemarks,
          expectedRevenue: input.expectedRevenue ?? null,
          assignedToId,
          stageId: stage?.id || null,
          lifecycleId: lifecycle?.id || null,
          sourceId: source?.id || null,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          stageEnteredAt: slaSnapshot.stageEnteredAt,
          stageExpiresAt: slaSnapshot.stageExpiresAt,
          slaAction: slaSnapshot.slaAction,
          slaWarningDays: slaSnapshot.slaWarningDays,
          isClosed: outcomeFlags.isClosed,
          isLOB: outcomeFlags.isLOB,
          closedAt: outcomeFlags.closedAt,
          closedById: outcomeFlags.closedById,
          closureType: outcomeFlags.closureType,
          generatedRevenue: outcomeFlags.generatedRevenue,
          totalAmount: resolvedTotalAmount,
          workspaceId,
          createdById: actor.id,
        },
        select: buildLeadSelect(includeProfileImageColumns),
      });

      logger.info('[Diagnostic] Lead record saved', { leadId: lead.id });

      if (leadRemarks) {
        await (tx as any).leadRemark.create({
          data: {
            text: leadRemarks,
            leadId: lead.id,
            createdById: actor.id,
            workspaceId,
          },
        });
      }

      await persistLeadDynamicValues(tx, workspaceId, lead.id, input.dynamicValues, actor.id, {
        requireAllRequired: true,
      });

      if (productSnapshots !== undefined) {
        await replaceLeadProducts(tx, workspaceId, lead.id, actor.id, productSnapshots);
      }

      if (input.nextFollowUpAt) {
        await createAutomaticFollowUp(
          tx,
          lead.id,
          workspaceId,
          followUpOwnerId,
          input.nextFollowUpAt,
          input.followUpDescription,
          normalizeFollowUpType(input.nextFollowUpType),
        );
      }

      if (stage?.isLOB) {
        await (tx as any).leadLOBLog.create({
          data: {
            leadId: lead.id,
            reasonId: input.reasonId!,
            remarks: lobRemarks,
            previousStageId: null,
            previousStageName: null,
            changedById: actor.id,
            workspaceId,
          },
        });
      }

      if (stage) {
        await (tx as any).leadStageHistory.create({
          data: {
            leadId: lead.id,
            fromStageId: null,
            fromStageName: null,
            toStageId: stage.id,
            toStageName: stage.name?.trim() || null,
            changedById: actor.id,
            workspaceId,
          },
        });
      }

      logger.info('[Diagnostic] Dynamic fields saved', { leadId: lead.id });

      // Save Payment Information
      if (resolvedTotalAmount > 0) {
        const inputReason = (input as any).totalAmountReason || (input as any).reason;
        await (tx as any).leadTotalAmountHistory.create({
          data: {
            leadId: lead.id,
            oldAmount: productTotal ?? 0,
            newAmount: resolvedTotalAmount,
            changedById: actor.id,
            reason: inputReason?.trim() || (productTotal !== undefined && Math.abs(resolvedTotalAmount - productTotal) > 0.01
              ? 'Manual price adjustment applied on creation.'
              : productSnapshots !== undefined
              ? 'Initial amount calculated from selected products.'
              : 'Initial amount set on lead creation.'),
          },
        });
        logger.info('[Diagnostic] Payment information saved', { leadId: lead.id, totalAmount: resolvedTotalAmount });
      }

      // Save Pending Advance Requests
      const advancePayments = (input as any).advancePayments;
      if (advancePayments && advancePayments.length > 0) {
        const creatorUser = await (tx as any).user.findFirst({
          where: { id: actor.id, workspaceId, deletedAt: null, isActive: true },
          select: { id: true, supervisorId: true },
        });

        if (!creatorUser?.supervisorId) {
          throw createServiceError(
            'You must have a supervisor assigned to your account before you can request an advance payment.',
            409,
          );
        }

        for (const advReq of advancePayments) {
          const adv = await (tx as any).advancePayment.create({
            data: {
              leadId: lead.id,
              workspaceId,
              amount: advReq.amount,
              paymentDate: new Date(advReq.paymentDate),
              proofUrl: advReq.proofUrl || null,
              remarks: advReq.remarks || null,
              requestedById: actor.id,
              status: 'PENDING',
            },
          });

          const approval = await (tx as any).leadStageApproval.create({
            data: {
              workspaceId,
              leadId: lead.id,
              type: 'ADVANCE_PAYMENT',
              requestedById: actor.id,
              assignedToId: creatorUser.supervisorId,
              status: 'PENDING',
              requestData: {
                advancePaymentId: adv.id,
                amount: advReq.amount,
                paymentDate: advReq.paymentDate,
                remarks: advReq.remarks || '',
                proofUrl: advReq.proofUrl || null,
              },
            },
          });

          await (tx as any).leadActivity.create({
            data: {
              leadId: lead.id,
              performedById: actor.id,
              workspaceId,
              action: 'ADVANCE_PAYMENT_REQUESTED',
              metadata: {
                advancePaymentId: adv.id,
                amount: advReq.amount,
                approvalId: approval.id,
              },
            },
          });

          await (tx as any).auditLog.create({
            data: {
              userId: actor.id,
              workspaceId,
              action: 'ADVANCE_PAYMENT_REQUESTED',
              entityType: 'Lead',
              entityId: lead.id,
              details: {
                advancePaymentId: adv.id,
                amount: advReq.amount,
                approvalId: approval.id,
              },
            },
          });
        }
        logger.info('[Diagnostic] Advance requests created', { leadId: lead.id, count: advancePayments.length });
      }

      if (leadRemarks) {
        await (tx as any).auditLog.create({
          data: {
            userId: actor.id,
            workspaceId,
            action: 'LEAD_REMARKS_CREATED',
            entityType: 'Lead',
            entityId: lead.id,
            details: {
              previousRemarks: null,
              newRemarks: leadRemarks,
              changedBy: actor.id,
              action: 'Lead Remarks Created',
            },
          },
        });
      }

      return lead.id;
    });

    logger.info('[Diagnostic] Database transaction committed', { leadId: createdLeadId });

    await clearLeadCache(workspaceId);
    if (input.nextFollowUpAt) {
      await touchFollowUpTodayCachesAfterLeadMutation(workspaceId, followUpOwnerId, input.nextFollowUpAt);
    }
    const created = await getLeadScoped(workspaceId, createdLeadId, actor);
    const dynamicValueMap = await fetchLeadDynamicValueMap([createdLeadId]);
    const starredLeadIds = await fetchStarredLeadIds(workspaceId, actor.id, [createdLeadId]);
    logger.info('[Diagnostic] API response returned', { leadId: createdLeadId });
    return { lead: mapLeadRecordWithDynamicValues(created, dynamicValueMap, starredLeadIds), autoSelfAssigned };
  } catch (error: any) {
    logger.info('[Diagnostic] Database transaction rolled back', { error: error?.message });
    throw error;
  }
};

export const getLeads = async (
  workspaceId: string,
  query: ListLeadsQueryInput,
  actor?: Actor,
): Promise<{
  leads: Array<ReturnType<typeof mapLeadRecord>>;
  expectedRevenue: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}> => {
  await assertModuleReady();
  maybeRunLeadSlaSweep(workspaceId).catch((err) => {
    logger.error('Background SLA sweep error:', { error: err?.message });
  });

  const cacheKey = buildLeadCacheKey(workspaceId, query, actor);
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const skip = (query.page - 1) * query.limit;
  const where = await buildListWhere(workspaceId, query, actor);
  const includeProfileImageColumns = await areLeadProfileImageColumnsReady();

  const [total, rows, expectedRevenue] = await Promise.all([
    (prisma as any).lead.count({ where }),
    (prisma as any).lead.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: buildLeadSelect(includeProfileImageColumns),
    }),
    calculateExpectedRevenueForWhere(where),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const leadRows = rows as LeadIncludeRecord[];
  const dynamicValueMap = await fetchLeadDynamicValueMap(leadRows.map((lead) => lead.id));
  const starredLeadIds = await fetchStarredLeadIds(workspaceId, actor?.id, leadRows.map((lead) => lead.id));
  const result = {
    leads: leadRows.map((lead) => mapLeadRecordWithDynamicValues(lead, dynamicValueMap, starredLeadIds)),
    expectedRevenue,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };

  await logLeadVisibilityDebug({
    workspaceId,
    actor,
    query,
    filteredTotal: total,
    responseCount: rows.length,
  });

  if (redisClient.isOpen) {
    await redisClient.setEx(cacheKey, LEADS_CACHE_TTL_SECONDS, JSON.stringify(result));
  }

  return result;
};

export const getLeadById = async (
  workspaceId: string,
  id: string,
  actor?: Actor,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();
  maybeRunLeadSlaSweep(workspaceId).catch((err) => {
    logger.error('Background SLA sweep error:', { error: err?.message });
  });
  const lead = await getLeadScoped(workspaceId, id, actor);
  const dynamicValueMap = await fetchLeadDynamicValueMap([id]);
  const starredLeadIds = await fetchStarredLeadIds(workspaceId, actor?.id, [id]);
  return mapLeadRecordWithDynamicValues(lead, dynamicValueMap, starredLeadIds);
};

export const setLeadStar = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  starred: boolean,
): Promise<{ leadId: string; isStarred: boolean }> => {
  await assertModuleReady();
  await getLeadScoped(workspaceId, id, actor);

  await prisma.$transaction(async (tx: any) => {
    await (tx as any).leadStar.upsert({
      where: {
        workspaceId_userId_leadId: {
          workspaceId,
          userId: actor.id,
          leadId: id,
        },
      },
      create: {
        workspaceId,
        userId: actor.id,
        leadId: id,
        isStarred: starred,
      },
      update: {
        isStarred: starred,
      },
    });

    await (tx as any).auditLog.create({
      data: {
        userId: actor.id,
        workspaceId,
        action: starred ? 'LEAD_STARRED' : 'LEAD_UNSTARRED',
        entityType: 'Lead',
        entityId: id,
        details: {
          leadId: id,
          isStarred: starred,
          changedBy: actor.id,
        },
      },
    });
  });

  await clearLeadCache(workspaceId);
  return { leadId: id, isStarred: starred };
};

export const updateLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateLeadInput,
): Promise<ReturnType<typeof mapLeadRecord> & { _approvalRequired?: boolean; _approval?: any }> => {
  await assertModuleReady();

  logger.info('Lead Update Started', { workspaceId, leadId: id, actorId: actor.id });

  const existing = await getLeadScoped(workspaceId, id, actor);
  
  const existingDynamicValues = await (prisma as any).leadDynamicValue.findMany({
    where: { leadId: id }
  });
  const changesToTrack = buildLeadChangesToTrack(existing, input, existingDynamicValues);

  const isReassigned = input.assignedToId !== undefined && input.assignedToId !== existing.assignedToId;

  if (
    existing.approvalState === 'PENDING' &&
    input.stageId !== undefined &&
    input.stageId !== existing.stageId
  ) {
    throw createServiceError(
      'This lead has a pending stage approval request. Resolve it before changing the stage again.',
      409,
    );
  }

  const nextFollowUpAt = input.nextFollowUpAt === null ? null : (input.nextFollowUpAt ?? existing.nextFollowUpAt);
  ensureFutureFollowUp(nextFollowUpAt);

  const email = input.email === null ? null : input.email?.trim() ?? existing.email;
  const phone = input.phone === null ? null : input.phone?.trim() ?? existing.phone;

  const normalizeEmailForCompare = (e?: string | null) => e?.trim().toLowerCase() || null;
  const normalizePhoneForCompare = (p?: string | null) => p?.trim() || null;

  const emailChanged = input.email !== undefined &&
    normalizeEmailForCompare(input.email) !== normalizeEmailForCompare(existing.email);
  const phoneChanged = input.phone !== undefined &&
    normalizePhoneForCompare(input.phone) !== normalizePhoneForCompare(existing.phone);

  if (emailChanged || phoneChanged) {
    const checkEmail = emailChanged ? (input.email?.trim() || null) : null;
    const checkPhone = phoneChanged ? (input.phone?.trim() || null) : null;
    await findDuplicateLead(workspaceId, checkEmail, checkPhone, id);
  }

  let assignedToId = existing.assignedToId;
  if (input.assignedToId !== undefined) {
    await ensureAssignmentUpdateAllowed(actor, existing.assignedToId, input.assignedToId);
    assignedToId = await resolveAssignedUserId(workspaceId, input.assignedToId);
  }
  const stage = input.stageId !== undefined ? await resolveStage(workspaceId, input.stageId) : existing.stage;
  const lifecycle = input.lifecycleId !== undefined ? await resolveLifecycle(workspaceId, input.lifecycleId) : existing.lifecycle;
  const source = input.sourceId !== undefined ? await resolveSource(workspaceId, input.sourceId) : existing.source;
  const lifecycleForSla =
    input.lifecycleId !== undefined
      ? lifecycle
      : input.stageId !== undefined && existing.lifecycleId
        ? await resolveLifecycle(workspaceId, existing.lifecycleId)
        : null;

  let approvalResult: any = null;
  if (
    input.stageId !== undefined &&
    stage?.id &&
    existing.stageId &&
    stage.id !== existing.stageId &&
    shouldRequireApprovalForStage(stage)
  ) {
    const requestingUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { supervisorId: true },
    });

    if (!requestingUser?.supervisorId && isManagerialRole(actor.role?.name)) {
      logger.info('Bypassing lead stage approval in updateLead for managerial user without supervisor', {
        userId: actor.id,
        role: actor.role?.name,
        targetStage: stage.name,
      });
    } else {
      const executionRules = await getActiveStageRulesForExecution(workspaceId, stage.id);
      const ruleNameById = new Map(executionRules.map((rule) => [rule.id, rule.name]));
      
      approvalResult = await leadApprovalService.createLeadApproval(
        workspaceId,
        { id: actor.id, roleId: actor.roleId ?? null, role: actor.role },
        {
          leadId: id,
          fromStageId: existing.stageId,
          toStageId: stage.id,
          requestData: {
            reasonId: input.reasonId ?? null,
            remarks: input.lobRemarks ?? input.remarks ?? null,
            nextFollowUpAt: input.nextFollowUpAt ? input.nextFollowUpAt.toISOString() : null,
            nextFollowUpType: input.nextFollowUpType ?? null,
            followUpDescription: input.followUpDescription ?? null,
            stageRuleValues: [],
            ...(stage.isLOB && existing.stageId
              ? {
                  previousStageId: existing.stageId,
                  previousStageName: existing.stage?.name ?? null,
                }
              : {}),
          },
        },
      );
      
      input.stageId = undefined;
    }
  }

  if (
    input.stageId !== undefined &&
    stage?.id &&
    existing.stageId &&
    stage.id !== existing.stageId
  ) {
    await validateClosedStageBalance(id, stage.id, workspaceId);
    const validationData = await toValidationLeadData(existing, input);
    await validateLeadStageTransition(workspaceId, stage.id, validationData, undefined);
  }

  const nextLeadRemarks = normalizeLeadRemarks(input.remarks);
  const lobRemarks = resolveLobRemarks(input, stage);
  const reasonId = input.reasonId === null ? null : input.reasonId ?? null;
  const isStageUpdateRequested = input.stageId !== undefined && input.stageId !== existing.stageId;
  if (isStageUpdateRequested && isLobStage(stage) && !existing.isLOB) {
    ensureLOBPayload(stage, reasonId, lobRemarks);
    await ensureValidLOBReasonForStage(workspaceId, stage, reasonId);
  }

  if (isStageUpdateRequested && existing.isLOB && stage && !isLobStage(stage)) {
    if (!nextLeadRemarks && !input.lobRemarks) {
      throw createServiceError('A mandatory reason is required when moving a lead out of LOB.', 422);
    }
  }
  const closureData = input.stageId !== undefined
    ? buildClosureUpdateData(stage as any, actor.id, {
        isClosed: existing.isClosed,
        closedAt: existing.closedAt,
        closedById: existing.closedById,
        generatedRevenue: existing.generatedRevenue,
        closureType: existing.closureType as any,
      })
    : {
        isClosed: existing.isClosed,
        closedAt: existing.closedAt,
        closedById: existing.closedById,
        closureType: existing.closureType as any,
        generatedRevenue: existing.generatedRevenue,
      };
  const nextStageId = stage?.id || null;
  const nextLifecycleId = lifecycle?.id || null;
  const nextLifecycleForSla =
    lifecycleForSla && 'transitions' in lifecycleForSla
      ? { transitions: lifecycleForSla.transitions }
      : null;
  const slaSnapshot = shouldRefreshSla(existing, nextStageId, nextLifecycleId)
    ? (isLobStage(stage) || isClosedWonStage(stage)
        ? emptySlaSnapshot()
        : await buildLeadSlaSnapshot(nextLifecycleForSla, nextStageId))
    : {
        stageEnteredAt: existing.stageEnteredAt,
        stageExpiresAt: existing.stageExpiresAt,
        slaAction: existing.slaAction,
        slaWarningDays: existing.slaWarningDays,
      };

  const updatedLeadId = await prisma.$transaction(async (tx: any) => {
    const productSnapshots = await resolveLeadProductSnapshots(tx, workspaceId, (input as any).products);
    const productTotal = sumProductSnapshots(productSnapshots);
    const resolvedTotalAmount =
      input.totalAmount !== undefined && input.totalAmount !== null
        ? Number(input.totalAmount)
        : productTotal !== undefined
          ? productTotal
          : undefined;

    await (tx as any).lead.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email } : {}),
        ...(input.phone !== undefined ? { phone } : {}),
        ...(input.companyName !== undefined
          ? { companyName: input.companyName === null ? null : input.companyName.trim() }
          : {}),
        ...(input.address !== undefined ? { address: input.address === null ? null : input.address.trim() } : {}),
        ...(input.remarks !== undefined ? { remarks: nextLeadRemarks ?? null } : {}),
        ...(input.expectedRevenue !== undefined
          ? { expectedRevenue: input.expectedRevenue === null ? null : input.expectedRevenue }
          : {}),
        ...(resolvedTotalAmount !== undefined
          ? { totalAmount: resolvedTotalAmount, generatedRevenue: resolvedTotalAmount }
          : {}),
        ...(input.assignedToId !== undefined ? { assignedToId } : {}),
        ...(input.stageId !== undefined ? { stageId: stage?.id || null } : {}),
        ...(input.lifecycleId !== undefined ? { lifecycleId: lifecycle?.id || null } : {}),
        ...(input.sourceId !== undefined ? { sourceId: source?.id || null } : {}),
        ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
        ...(shouldRefreshSla(existing, nextStageId, nextLifecycleId)
          ? {
              stageEnteredAt: slaSnapshot.stageEnteredAt,
              stageExpiresAt: slaSnapshot.stageExpiresAt,
              slaAction: slaSnapshot.slaAction,
              slaWarningDays: slaSnapshot.slaWarningDays,
            }
          : {}),
        ...(input.isClosed !== undefined ? { isClosed: input.isClosed } : {}),
        ...(stage
          ? (() => {
              const outcomeFlags = buildLeadOutcomeFlagsFromStage(stage, actor.id, {
                isClosed: closureData.isClosed,
                closedAt: closureData.closedAt,
                closedById: closureData.closedById,
                closureType: closureData.closureType,
                generatedRevenue: closureData.generatedRevenue,
              });
              return {
                isLOB: outcomeFlags.isLOB,
                isClosed: outcomeFlags.isClosed,
                closedAt: outcomeFlags.closedAt,
                closedById: outcomeFlags.closedById,
                closureType: outcomeFlags.closureType,
                generatedRevenue: outcomeFlags.generatedRevenue,
              };
            })()
          : {}),
      },
    });

    if (nextLeadRemarks) {
      await (tx as any).leadRemark.create({
        data: {
          text: nextLeadRemarks,
          leadId: id,
          createdById: actor.id,
          workspaceId,
        },
      });
    }

    await persistLeadDynamicValues(tx, workspaceId, id, input.dynamicValues, actor.id);

    if (productSnapshots !== undefined) {
      await replaceLeadProducts(tx, workspaceId, id, actor.id, productSnapshots);
    }
    
    await trackFieldEdits(tx, workspaceId, id, actor.id, changesToTrack, input.remarks || undefined);

    if (resolvedTotalAmount !== undefined && Math.abs(Number(resolvedTotalAmount) - Number(existing.totalAmount || 0)) > 0.01) {
      const inputReason = (input as any).totalAmountReason || (input as any).reason;
      await (tx as any).leadTotalAmountHistory.create({
        data: {
          leadId: id,
          oldAmount: Number(existing.totalAmount || 0),
          newAmount: Number(resolvedTotalAmount),
          changedById: actor.id,
          reason: inputReason?.trim() || (productTotal !== undefined && Math.abs(Number(resolvedTotalAmount) - productTotal) > 0.01
            ? 'Manual price adjustment applied on lead update.'
            : 'Total amount updated.'),
        },
      });
    }

    const followUpOwnerId = assignedToId || existing.createdById;

    const isEnteringLOB = stage?.isLOB && !existing.isLOB;

    if (isEnteringLOB) {
      await (tx as any).followUp.updateMany({
        where: {
          leadId: id,
          workspaceId,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          completionDescription: 'Superseded by LOB Workflow',
        },
      });
    }

    if (input.assignedToId !== undefined && existing.assignedToId !== assignedToId) {
      await (tx as any).followUp.updateMany({
        where: {
          leadId: id,
          workspaceId,
          status: 'PENDING',
        },
        data: {
          userId: followUpOwnerId,
        },
      });
    }

    const shouldCreateNewAutoFollowUp =
      Boolean(input.nextFollowUpAt) &&
      (!existing.nextFollowUpAt || existing.nextFollowUpAt.getTime() !== input.nextFollowUpAt!.getTime());

    if (shouldCreateNewAutoFollowUp) {
      await createAutomaticFollowUp(
        tx,
        id,
        workspaceId,
        followUpOwnerId,
        input.nextFollowUpAt!,
        input.followUpDescription,
        normalizeFollowUpType(input.nextFollowUpType),
      );
    } else if (
      nextFollowUpAt &&
      (input.nextFollowUpType !== undefined || input.followUpDescription !== undefined)
    ) {
      const pending = await (tx as any).followUp.findFirst({
        where: {
          leadId: id,
          workspaceId,
          status: 'PENDING',
          scheduledAt: nextFollowUpAt,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (pending) {
        await (tx as any).followUp.update({
          where: { id: pending.id },
          data: {
            ...(input.nextFollowUpType !== undefined ? { type: normalizeFollowUpType(input.nextFollowUpType) } : {}),
            ...(input.followUpDescription !== undefined
              ? {
                  description:
                    input.followUpDescription?.trim() || 'Auto-created from lead workflow',
                }
              : {}),
          },
        });
      }
    }

    if (isEnteringLOB) {
      await (tx as any).leadLOBLog.create({
        data: {
          leadId: id,
          reasonId: reasonId!,
          remarks: lobRemarks,
          previousStageId: existing.stageId,
          previousStageName: existing.stage?.name?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    if (stage && existing.stageId !== stage.id) {
      await (tx as any).leadStageHistory.create({
        data: {
          leadId: id,
          fromStageId: existing.stageId,
          fromStageName: existing.stage?.name?.trim() || null,
          toStageId: stage.id,
          toStageName: stage.name?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    await syncLeadRevenueTransaction(tx, workspaceId, id, nextStageId || existing.stageId || stage?.id || null, actor.id);

    return id;
  });

  await clearLeadCache(workspaceId);
  if (
    nextFollowUpAt &&
    (input.nextFollowUpAt !== undefined || input.nextFollowUpType !== undefined || input.followUpDescription !== undefined)
  ) {
    await touchFollowUpTodayCachesAfterLeadMutation(workspaceId, assignedToId || existing.createdById, nextFollowUpAt);
  }
  const updated = await getLeadScoped(workspaceId, updatedLeadId, actor);
  const dynamicValueMap = await fetchLeadDynamicValueMap([updatedLeadId]);
  const starredLeadIds = await fetchStarredLeadIds(workspaceId, actor.id, [updatedLeadId]);
  const result = mapLeadRecordWithDynamicValues(updated, dynamicValueMap, starredLeadIds);
  if (approvalResult) {
    (result as any)._approvalRequired = true;
    (result as any)._approval = approvalResult.approval;
  }
  (result as any)._changes = changesToTrack;
  logger.info('Lead Update Completed', { workspaceId, leadId: id });
  return result;
};

export const changeStage = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: ChangeStageInput,
): Promise<
  | { approvalRequired: false; lead: ReturnType<typeof mapLeadRecord> }
  | { approvalRequired: true; lead: any; approval: any }
> => {
  await assertModuleReady();

  const existing = await getLeadScoped(workspaceId, id, actor);
  const targetStage = await resolveStage(workspaceId, input.stageId);

  if (!targetStage) {
    throw createServiceError('Lead stage was not found.', 404);
  }

  if (existing.stageId && existing.stageId !== targetStage.id) {
    await validateClosedStageBalance(id, targetStage.id, workspaceId);
    const validationData = await toValidationLeadData(existing, input);
    const stageRuleAnswers = stageRuleValuesToAnswerMap(input.stageRuleValues);
    await validateLeadStageTransition(workspaceId, targetStage.id, validationData, stageRuleAnswers);
  }

  const isMovingOutOfLob = existing.isLOB && !isLobStage(targetStage);
  if (isLobStage(targetStage)) {
    ensureLOBPayload(targetStage, input.reasonId, input.remarks ?? null);
    await ensureValidLOBReasonForStage(workspaceId, targetStage, input.reasonId);
  }

  if (isMovingOutOfLob && !normalizeLeadRemarks(input.remarks)) {
    throw createServiceError('A mandatory reason is required when moving a lead out of LOB.', 422);
  }

  if (existing.stageId !== targetStage.id && shouldRequireApprovalForStage(targetStage)) {
    const requestingUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { supervisorId: true },
    });

    if (!requestingUser?.supervisorId && isManagerialRole(actor.role?.name)) {
      logger.info('Bypassing lead stage approval for managerial user without supervisor', {
        userId: actor.id,
        role: actor.role?.name,
        targetStage: targetStage.name,
      });
    } else {
      const executionRules = await getActiveStageRulesForExecution(workspaceId, targetStage.id);
      const ruleNameById = new Map(executionRules.map((rule) => [rule.id, rule.name]));
      const stageRuleValuesForRequest = (input.stageRuleValues ?? []).map((entry) => ({
        ruleId: entry.ruleId,
        value: entry.value,
        ruleName: ruleNameById.get(entry.ruleId) || entry.ruleId,
      }));

      const result = await leadApprovalService.createLeadApproval(
        workspaceId,
        { id: actor.id, roleId: actor.roleId ?? null, role: actor.role },
        {
          leadId: id,
          fromStageId: existing.stageId!,
          toStageId: targetStage.id,
          requestData: {
            reasonId: input.reasonId ?? null,
            remarks: input.remarks ?? null,
            nextFollowUpAt: input.nextFollowUpAt ? input.nextFollowUpAt.toISOString() : null,
            nextFollowUpType: input.nextFollowUpType ?? null,
            followUpDescription: input.followUpDescription ?? null,
            stageRuleValues: stageRuleValuesForRequest,
            ...(targetStage.isLOB && existing.stageId
              ? {
                  previousStageId: existing.stageId,
                  previousStageName: existing.stage?.name ?? null,
                }
              : {}),
          },
        },
      );

      return {
        approvalRequired: true,
        lead: result.lead,
        approval: result.approval,
      };
    }
  }

  const updatedLead = await updateLead(workspaceId, actor, id, {
    stageId: input.stageId,
    reasonId: input.reasonId,
    remarks: input.remarks,
    nextFollowUpAt: input.nextFollowUpAt,
    nextFollowUpType: input.nextFollowUpType,
    followUpDescription: input.followUpDescription,
  });

  if (existing.stageId && existing.stageId !== targetStage.id) {
    await persistLeadStageRuleValues(id, input.stageRuleValues);
  }

  return {
    approvalRequired: false,
    lead: updatedLead,
  };
};

export const assignLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: AssignLeadInput,
): Promise<ReturnType<typeof mapLeadRecord>> =>
  updateLead(workspaceId, actor, id, {
    assignedToId: input.assignedToId,
  });

export const extendLeadSla = async (
  workspaceId: string,
  id: string,
  extraDays: number,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();

  const lead = await getLeadScoped(workspaceId, id);
  if (lead.isClosed || lead.isLOB) {
    throw createServiceError('Only active leads can have their lifecycle timer extended.', 409);
  }

  if (!lead.stageExpiresAt) {
    throw createServiceError('This lead does not have an active lifecycle timer to extend.', 409);
  }

  if (lead.slaAction !== 'WARN_AND_CHOOSE') {
    throw createServiceError('This lead is configured to move to LOB automatically on expiry.', 409);
  }

  const updated = await (prisma as any).lead.update({
    where: { id },
    data: {
      stageExpiresAt: addDays(lead.stageExpiresAt, extraDays),
    },
    select: buildLeadSelect(await areLeadProfileImageColumnsReady()),
  });

  await clearLeadCache(workspaceId);
  return mapLeadRecord(updated as LeadIncludeRecord);
};

export const deleteLead = async (workspaceId: string, id: string): Promise<void> => {
  await assertModuleReady();

  const lead = await (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: {
      id: true,
      deletedAt: true,
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  if (lead.deletedAt) {
    await clearLeadCache(workspaceId);
    return;
  }

  await (prisma as any).lead.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await clearLeadCache(workspaceId);
};

export const permanentlyDeleteLead = async (workspaceId: string, id: string): Promise<void> => {
  await assertModuleReady();

  const lead = await (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  await prisma.$transaction(async (tx: any) => {
    await (tx as any).leadDynamicValue.deleteMany({
      where: {
        leadId: id,
      },
    });

    await (tx as any).lead.update({
      where: { id },
      data: {
        name: `Deleted Lead ${id.slice(-6)}`,
        email: null,
        phone: null,
        expectedRevenue: null,
        generatedRevenue: 0,
        assignedToId: null,
        stageId: null,
        lifecycleId: null,
        sourceId: null,
        nextFollowUpAt: null,
        stageEnteredAt: null,
        stageExpiresAt: null,
        slaAction: null,
        slaWarningDays: null,
        approvalState: 'NONE',
        pendingApprovalToStageId: null,
        pendingApprovalRequestedAt: null,
        isClosed: false,
        isLOB: false,
        closedAt: null,
        closedById: null,
        closureType: null,
        deletedAt: new Date(),
      },
    });
  });

  await clearLeadCache(workspaceId);
};

export const bulkDeleteLeads = async (workspaceId: string, ids: string[], permanent: boolean = false): Promise<void> => {
  await assertModuleReady();

  if (!ids || ids.length === 0) return;

  // Clear cache BEFORE 
  await clearLeadCache(workspaceId);

  if (permanent) {
    await prisma.$transaction(async (tx: any) => {
      // 1. Delete associated dynamic values first
      await (tx as any).leadDynamicValue.deleteMany({
        where: { leadId: { in: ids } },
      });

      // 2. Performance: Use updateMany instead of individual updates to avoid timeout
      await (tx as any).lead.updateMany({
        where: { id: { in: ids }, workspaceId },
        data: {
          email: null,
          phone: null,
          expectedRevenue: null,
          generatedRevenue: 0,
          assignedToId: null,
          stageId: null,
          lifecycleId: null,
          sourceId: null,
          nextFollowUpAt: null,
          stageEnteredAt: null,
          stageExpiresAt: null,
          slaAction: null,
          slaWarningDays: null,
          approvalState: 'NONE',
          pendingApprovalToStageId: null,
          pendingApprovalRequestedAt: null,
          isClosed: false,
          isLOB: false,
          closedAt: null,
          closedById: null,
          closureType: null,
          deletedAt: new Date(),
        },
      });
    }, { 
      // Increase timeout to 30s to be safe for large batches
      timeout: 30000 
    });
  } else {
    // Standard archiving is fast with updateMany
    await (prisma as any).lead.updateMany({
      where: { id: { in: ids }, workspaceId },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  // Clear cache AFTER
  // We keep the tiny delay for consistency, then wipe the cache
  await new Promise((resolve) => setTimeout(resolve, 150));
  await clearLeadCache(workspaceId);
};

const buildLeadExportCsvRow = (
  slNo: number,
  lead: LeadIncludeRecord,
  dynamicFields: Array<{ id: string }>,
  dynamicValues: LeadDynamicValueRecord[] = [],
): unknown[] => {
  const dynamicValueByFieldId = new Map(dynamicValues.map((entry) => [entry.fieldId, entry.value]));
  const totalAmount = lead.totalAmount !== null && lead.totalAmount !== undefined ? Number(lead.totalAmount) : 0;
  const advanceAmount = Number(
    (lead as any).advanceAmount ?? 
    (lead.advancePayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0)
  );
  const balanceAmount = Math.max(0, totalAmount - advanceAmount);
  const productsStr = lead.products?.map((p: any) => `${p.productName || 'Product'} × ${p.quantity || 1}`).join('; ') || '';

  return [
    slNo,
    lead.name,
    lead.email || '',
    formatPhoneStr(lead.phone),
    lead.companyName || '',
    lead.address || '',
    lead.remarks || '',
    lead.expectedRevenue !== null && lead.expectedRevenue !== undefined ? Number(lead.expectedRevenue) : '',
    lead.assignedTo ? resolveDisplayName(lead.assignedTo) : '',
    lead.assignedTo?.office?.name || '',
    lead.stage?.name || '',
    lead.lifecycle?.name || '',
    lead.source?.name || '',
    totalAmount,
    advanceAmount,
    balanceAmount,
    ((lead as any).lastRemark ?? extractLastRemark(lead)) || '',
    lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : '',
    lead.isClosed ? 'Yes' : 'No',
    lead.isLOB ? 'Yes' : 'No',
    deletedAtToExport(lead),
    resolveDisplayName(lead.createdBy),
    lead.createdAt.toISOString(),
    lead.updatedAt.toISOString(),
    productsStr,
    ...dynamicFields.map((field) => dynamicValueByFieldId.get(field.id) || ''),
  ];
};

const deletedAtToExport = (lead: LeadIncludeRecord): string => lead.deletedAt ? lead.deletedAt.toISOString() : '';

export const exportLeads = async (
  workspaceId: string,
  query: ExportLeadsQueryInput,
  actor?: Actor,
): Promise<{ filename: string; content: string; contentType: string }> => {
  await assertModuleReady();

  const where = await buildListWhere(workspaceId, query, actor, { includeArchived: query.includeArchived });
  const dynamicFields = await (prisma as any).leadDynamicField.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  }) as Array<{ id: string; name: string }>;

  const allHeaders = [
    'SL No.',
    'Lead Name',
    'Email',
    'Mobile Number',
    'Company Name',
    'Address',
    'Remarks',
    'Expected Revenue Contribution',
    'Assigned User',
    'Reporting Office',
    'Current Lead Stage',
    'Lead Lifecycle',
    'Lead Source',
    'Total Amount',
    'Approved Advance Amount',
    'Balance Amount',
    'Last Remark',
    'Next Follow Up At',
    'Is Closed',
    'Is LOB',
    'Archived At',
    'Created By',
    'Created Date',
    'Updated Date',
    'Products',
    ...dynamicFields.map((field) => field.name),
  ];

  const allFieldIds = [
    'sl_no',
    'name',
    'email',
    'phone',
    'companyName',
    'address',
    'remarks',
    'expectedRevenue',
    'assignedUser',
    'reportingOffice',
    'stage',
    'lifecycle',
    'source',
    'totalAmount',
    'advanceAmount',
    'balanceAmount',
    'lastRemark',
    'nextFollowUpAt',
    'isClosed',
    'isLOB',
    'archivedAt',
    'createdBy',
    'createdAt',
    'updatedAt',
    'products',
    ...dynamicFields.map((field) => field.id),
  ];

  let reqFields: string[] = [];
  if (query.fields) {
    reqFields = Array.isArray(query.fields) ? query.fields : (query.fields as string).split(',');
  }

  const keepIndices = reqFields.length > 0 
    ? reqFields.map(id => allFieldIds.indexOf(id)).filter(i => i !== -1)
    : allFieldIds.map((_, i) => i);

  const headers = keepIndices.map(i => allHeaders[i]);

  // Cursor batching: stable order by id so exports scale without loading the full table into memory.
  const EXPORT_BATCH = 750;
  const lines: unknown[][] = [];
  let cursorId: string | undefined;
  let slNoCounter = 1;

  for (;;) {
    const batch = (await (prisma as any).lead.findMany({
      where,
      take: EXPORT_BATCH,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: buildLeadSelect(await areLeadProfileImageColumnsReady()),
    })) as LeadIncludeRecord[];

    if (!batch.length) {
      break;
    }

    const dynamicValueMap = await fetchLeadDynamicValueMap(batch.map((lead) => lead.id));

    for (const lead of batch) {
      const fullRow = buildLeadExportCsvRow(slNoCounter++, lead, dynamicFields, dynamicValueMap.get(lead.id));
      lines.push(keepIndices.map(i => fullRow[i]));
    }

    if (batch.length < EXPORT_BATCH) {
      break;
    }

    cursorId = batch[batch.length - 1]!.id;
  }

  const content = [headers, ...lines].map((row) => row.map(escapeCsv).join(',')).join('\n');
  return {
    filename: `leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
    content,
    contentType: 'text/csv; charset=utf-8',
  };
};

export const canAssignOtherUsers = async (actor: Actor): Promise<boolean> =>
  actorCanAssignToOthers(actor);

export const exportLeadsXlsx = async (
  workspaceId: string,
  query: ExportLeadsQueryInput,
  actor?: Actor,
): Promise<{ filename: string; buffer: Buffer; contentType: string }> => {
  await assertModuleReady();

  const where = await buildListWhere(workspaceId, query, actor, { includeArchived: query.includeArchived });
  const dynamicFields = await (prisma as any).leadDynamicField.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  }) as Array<{ id: string; name: string }>;

  const allHeaders = [
    'SL No.',
    'Lead Name',
    'Email',
    'Mobile Number',
    'Company Name',
    'Address',
    'Remarks',
    'Expected Revenue Contribution',
    'Assigned User',
    'Reporting Office',
    'Current Lead Stage',
    'Lead Lifecycle',
    'Lead Source',
    'Total Amount',
    'Approved Advance Amount',
    'Balance Amount',
    'Last Remark',
    'Next Follow Up At',
    'Is Closed',
    'Is LOB',
    'Archived At',
    'Created By',
    'Created Date',
    'Updated Date',
    'Products',
    ...dynamicFields.map((field) => field.name),
  ];

  const allFieldIds = [
    'sl_no',
    'name',
    'email',
    'phone',
    'companyName',
    'address',
    'remarks',
    'expectedRevenue',
    'assignedUser',
    'reportingOffice',
    'stage',
    'lifecycle',
    'source',
    'totalAmount',
    'advanceAmount',
    'balanceAmount',
    'lastRemark',
    'nextFollowUpAt',
    'isClosed',
    'isLOB',
    'archivedAt',
    'createdBy',
    'createdAt',
    'updatedAt',
    'products',
    ...dynamicFields.map((field) => field.id),
  ];

  let reqFields: string[] = [];
  if (query.fields) {
    reqFields = Array.isArray(query.fields) ? query.fields : (query.fields as string).split(',');
  }

  const keepIndices = reqFields.length > 0 
    ? reqFields.map(id => allFieldIds.indexOf(id)).filter(i => i !== -1)
    : allFieldIds.map((_, i) => i);

  const headers = keepIndices.map(i => allHeaders[i]);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Leads');

  // Freeze top row
  worksheet.views = [
    { state: 'frozen', ySplit: 1, activeCell: 'A2' }
  ];

  // Set columns
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: 20
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  // Fetch all leads using cursor batching
  const EXPORT_BATCH = 750;
  let cursorId: string | undefined;
  let slNoCounter = 1;

  const tz = await getWorkspaceTimeZone(workspaceId);

  const formatExcelDate = (date: Date | null | undefined, includeTime = true): string => {
    if (!date) return '';
    const m = moment(date).tz(tz);
    if (!m.isValid()) return '';
    return m.format(includeTime ? 'DD-MMM-YYYY hh:mm A' : 'DD-MMM-YYYY');
  };

  for (;;) {
    const batch = (await (prisma as any).lead.findMany({
      where,
      take: EXPORT_BATCH,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: buildLeadSelect(await areLeadProfileImageColumnsReady()),
    })) as LeadIncludeRecord[];

    if (!batch.length) {
      break;
    }

    const dynamicValueMap = await fetchLeadDynamicValueMap(batch.map((lead) => lead.id));

    for (const lead of batch) {
      const dynamicValueByFieldId = new Map(
        (dynamicValueMap.get(lead.id) || []).map((entry) => [entry.fieldId, entry.value])
      );
      
      const totalAmount = lead.totalAmount !== null ? Number(lead.totalAmount) : 0;
      const advanceAmount = Number(
        (lead as any).advanceAmount ?? 
        (lead.advancePayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0)
      );
      const balanceAmount = Math.max(0, totalAmount - advanceAmount);
      const productsStr = lead.products?.map((p: any) => `${p.productName || 'Product'} × ${p.quantity || 1}`).join('; ') || '';
      
      const fullRow = [
        slNoCounter++,
        lead.name,
        lead.email || '',
        lead.phone || '', // Mobile Number
        lead.companyName || '',
        lead.address || '',
        lead.remarks || '',
        lead.expectedRevenue !== null && lead.expectedRevenue !== undefined ? Number(lead.expectedRevenue) : '',
        lead.assignedTo ? resolveDisplayName(lead.assignedTo) : '',
        lead.assignedTo?.office?.name || '', // Reporting Office
        lead.stage?.name || '',
        lead.lifecycle?.name || '',
        lead.source?.name || '',
        totalAmount,
        advanceAmount,
        balanceAmount,
        ((lead as any).lastRemark ?? extractLastRemark(lead)) || '',
        formatExcelDate(lead.nextFollowUpAt, true), // Next Follow Up At
        lead.isClosed ? 'Yes' : 'No',
        lead.isLOB ? 'Yes' : 'No',
        formatExcelDate(lead.deletedAt, true), // Archived At
        resolveDisplayName(lead.createdBy),
        formatExcelDate(lead.createdAt, true), // Created Date
        formatExcelDate(lead.updatedAt, true), // Updated Date
        productsStr,
        ...dynamicFields.map((field) => dynamicValueByFieldId.get(field.id) || ''),
      ];

      const rowData = keepIndices.map(i => fullRow[i]);
      const newRow = worksheet.addRow(rowData);

      const stageFullIndex = allFieldIds.indexOf('stage');
      const stageExportIndex = keepIndices.indexOf(stageFullIndex);
      
      if (stageExportIndex !== -1 && lead.stage?.color) {
        const cell = newRow.getCell(stageExportIndex + 1);
        const hexColor = lead.stage.color.replace('#', '');
        cell.font = { 
          color: { argb: 'FF' + hexColor }, 
          bold: true 
        };
      }
    }

    if (batch.length < EXPORT_BATCH) {
      break;
    }

    cursorId = batch[batch.length - 1]!.id;
  }

  // Enable auto-filter
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: worksheet.rowCount, column: headers.length }
  };

  // Adjust column widths, alignment, format types
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers

    // Mobile Number (col 4) - Force text formatting to preserve plus/zeros
    const phoneCell = row.getCell(4);
    if (phoneCell.value) {
      phoneCell.numFmt = '@';
      phoneCell.value = String(phoneCell.value);
    }

    // Right-align currency / numeric values
    [8, 14, 15, 16].forEach((colIdx) => {
      const cell = row.getCell(colIdx);
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      }
    });

    // Wrap text for Address, Remarks, Last Remark, Products
    [6, 7, 17, 25].forEach((colIdx) => {
      const cell = row.getCell(colIdx);
      if (cell.value) {
        cell.alignment = { wrapText: true };
      }
    });
  });

  // Auto-adjust column widths based on maximum content length
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell!({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value;
      if (cellValue) {
        const len = String(cellValue).length;
        if (len > maxLength) {
          maxLength = len;
        }
      }
    });
    column.width = Math.min(45, maxLength + 3);
  });

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

  const isFiltered = Object.keys(query).some(k => k !== 'includeArchived' && query[k as keyof ExportLeadsQueryInput] !== undefined);
  const prefix = isFiltered ? 'Leads_Filtered_' : 'Leads_';
  const filename = `${prefix}${new Date().toISOString().slice(0, 10)}.xlsx`;

  try {
    await (prisma as any).leadActivity.create({
      data: {
        leadId: '', // System-wide audit log
        performedById: actor?.id || '',
        workspaceId,
        action: 'EXPORT_BULK',
        description: `Lead XLSX Exported. Applied filters: ${JSON.stringify(query)}. Format: XLSX. Record count: ${slNoCounter - 1}.`,
      }
    });
  } catch (auditError) {
    logger.error(`Failed to audit lead XLSX export: ${auditError}`);
  }

  return {
    filename,
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
};
