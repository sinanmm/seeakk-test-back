import prisma from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { buildAccessWhere } from '../leads/leads.service';
import { buildCustomPipelineWhere, FilterCondition } from './customPipelineEngine.service';
import type {
  CreateSectionInput,
  UpdateSectionInput,
  CreatePipelineInput,
  UpdatePipelineInput,
  PreviewPipelineInput,
} from './customPipeline.validation';
import logger from '../../utils/logger';

export interface RequestActor {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
  officeId?: string | null;
  departmentId?: string | null;
  isSuperAdmin?: boolean;
}

// ----------------------------------------------------
// Section & Pipeline Visibility Filter
// ----------------------------------------------------
const buildVisibilityWhere = (actor: RequestActor): Prisma.DashboardPipelineSectionWhereInput => {
  const roleName = actor.role?.name?.toUpperCase() || '';
  if (actor.isSuperAdmin || roleName === 'SUPER_ADMIN' || roleName === 'ADMIN') {
    return {};
  }

  const shareTargets: Prisma.DashboardPipelineShareWhereInput[] = [{ targetUserId: actor.id }];
  if (actor.roleId) shareTargets.push({ targetRoleId: actor.roleId });
  if (actor.officeId) shareTargets.push({ targetOfficeId: actor.officeId });
  if (actor.departmentId) shareTargets.push({ targetDepartmentId: actor.departmentId });

  const orConditions: Prisma.DashboardPipelineSectionWhereInput[] = [
    { ownerUserId: actor.id },
    { visibilityType: 'WORKSPACE' },
    {
      visibilityType: 'SHARED',
      shares: {
        some: {
          OR: shareTargets,
        },
      },
    },
  ];

  return { OR: orConditions };
};

// ----------------------------------------------------
// Sections Services
// ----------------------------------------------------
export const getPipelineSections = async (workspaceId: string, actor: RequestActor) => {
  const visibilityWhere = buildVisibilityWhere(actor);

  let sections: any[] = [];
  try {
    sections = await prisma.dashboardPipelineSection.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: 'ACTIVE',
        ...visibilityWhere,
      },
      include: {
        pipelines: {
          where: {
            deletedAt: null,
            status: 'ACTIVE',
          },
          orderBy: { sortOrder: 'asc' },
          include: {
            shares: true,
          },
        },
        shares: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  } catch (err: any) {
    logger.warn('[Custom Pipeline] Failed to query pipeline sections table from database', {
      error: err?.message,
      workspaceId,
      userId: actor.id,
    });
    return [];
  }

  // Calculate live metrics for each pipeline
  let scopedLeadAccess: Prisma.LeadWhereInput = {};
  try {
    scopedLeadAccess = await buildAccessWhere(workspaceId, actor);
  } catch (err) {
    logger.warn('[Custom Pipeline] Lead access scope empty or access restricted', { userId: actor.id });
    scopedLeadAccess = { id: { in: [] } };
  }

  const populatedSections = await Promise.all(
    sections.map(async (section: any) => {
      const populatedPipelines = await Promise.all(
        section.pipelines.map(async (pipeline: any) => {
          let metrics: any = {
            count: 0,
            totalExpectedRevenue: 0,
            totalClosedRevenue: 0,
            averageRevenue: 0,
            secondaryMetric: 0,
            stageBreakdown: [],
            lastRefreshedAt: new Date().toISOString(),
          };

          try {
            metrics = await computePipelineMetrics(
              workspaceId,
              pipeline.filtersJson as unknown as FilterCondition[],
              pipeline.filterLogic as 'AND' | 'OR',
              pipeline.metricType,
              scopedLeadAccess,
              pipeline.displayType,
              pipeline.segmentsJson as any,
            );
          } catch (err: any) {
            logger.error('[Custom Pipeline Metrics Compute Failed]', {
              pipelineId: pipeline.id,
              pipelineName: pipeline.name,
              error: err?.message,
              stack: err?.stack,
            });
          }

          return {
            ...pipeline,
            metrics,
          };
        }),
      );

      return {
        ...section,
        pipelines: populatedPipelines,
      };
    }),
  );

  return populatedSections;
};

export const createPipelineSection = async (workspaceId: string, actor: RequestActor, input: CreateSectionInput) => {
  const maxOrder = await prisma.dashboardPipelineSection.aggregate({
    where: { workspaceId, deletedAt: null },
    _max: { sortOrder: true },
  });

  const nextOrder = (maxOrder._max.sortOrder ?? 0) + 1;

  const section = await prisma.dashboardPipelineSection.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description,
      layoutType: input.layoutType,
      visibilityType: input.visibilityType,
      sortOrder: input.sortOrder || nextOrder,
      ownerUserId: actor.id,
      createdById: actor.id,
      shares: input.shares
        ? {
            create: input.shares.map((s: any) => ({
              workspaceId,
              shareType: s.shareType,
              ...(s.shareType === 'USER' && { targetUserId: s.targetId }),
              ...(s.shareType === 'ROLE' && { targetRoleId: s.targetId }),
              ...(s.shareType === 'OFFICE' && { targetOfficeId: s.targetId }),
              ...(s.shareType === 'DEPARTMENT' && { targetDepartmentId: s.targetId }),
            })),
          }
        : undefined,
    },
    include: {
      pipelines: true,
      shares: true,
    },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    sectionId: section.id,
    action: 'SECTION_CREATED',
    newValue: { name: section.name, layoutType: section.layoutType },
  });

  return section;
};

export const updatePipelineSection = async (
  workspaceId: string,
  sectionId: string,
  actor: RequestActor,
  input: UpdateSectionInput,
) => {
  const existing = await prisma.dashboardPipelineSection.findFirst({
    where: { id: sectionId, workspaceId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Pipeline section not found');
  }

  if (input.shares) {
    await prisma.dashboardPipelineShare.deleteMany({
      where: { sectionId },
    });
  }

  const updated = await prisma.dashboardPipelineSection.update({
    where: { id: sectionId },
    data: {
      name: input.name,
      description: input.description,
      layoutType: input.layoutType,
      visibilityType: input.visibilityType,
      status: input.status,
      sortOrder: input.sortOrder,
      shares: input.shares
        ? {
            create: input.shares.map((s: any) => ({
              workspaceId,
              shareType: s.shareType,
              ...(s.shareType === 'USER' && { targetUserId: s.targetId }),
              ...(s.shareType === 'ROLE' && { targetRoleId: s.targetId }),
              ...(s.shareType === 'OFFICE' && { targetOfficeId: s.targetId }),
              ...(s.shareType === 'DEPARTMENT' && { targetDepartmentId: s.targetId }),
            })),
          }
        : undefined,
    },
    include: {
      pipelines: true,
      shares: true,
    },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    sectionId,
    action: 'SECTION_UPDATED',
    previousValue: { name: existing.name, layoutType: existing.layoutType },
    newValue: { name: updated.name, layoutType: updated.layoutType },
  });

  return updated;
};

export const deletePipelineSection = async (
  workspaceId: string,
  sectionId: string,
  actor: RequestActor,
  movePipelinesToSectionId?: string,
) => {
  const section = await prisma.dashboardPipelineSection.findFirst({
    where: { id: sectionId, workspaceId, deletedAt: null },
    include: { pipelines: true },
  });

  if (!section) {
    throw new Error('Pipeline section not found');
  }

  if (movePipelinesToSectionId) {
    await prisma.dashboardPipeline.updateMany({
      where: { sectionId, workspaceId, deletedAt: null },
      data: { sectionId: movePipelinesToSectionId },
    });
  } else {
    await prisma.dashboardPipeline.updateMany({
      where: { sectionId, workspaceId },
      data: { deletedAt: new Date() },
    });
  }

  await prisma.dashboardPipelineSection.update({
    where: { id: sectionId },
    data: { deletedAt: new Date() },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    sectionId,
    action: 'SECTION_DELETED',
    previousValue: { name: section.name, pipelineCount: section.pipelines.length },
  });

  return { success: true };
};

export const reorderPipelineSections = async (
  workspaceId: string,
  sections: Array<{ id: string; sortOrder: number }>,
) => {
  await Promise.all(
    sections.map((sec) =>
      prisma.dashboardPipelineSection.updateMany({
        where: { id: sec.id, workspaceId },
        data: { sortOrder: sec.sortOrder },
      }),
    ),
  );
  return { success: true };
};

// ----------------------------------------------------
// Pipeline Services
// ----------------------------------------------------
export const createPipeline = async (workspaceId: string, actor: RequestActor, input: CreatePipelineInput) => {
  const maxOrder = await prisma.dashboardPipeline.aggregate({
    where: { sectionId: input.sectionId, workspaceId, deletedAt: null },
    _max: { sortOrder: true },
  });

  const nextOrder = (maxOrder._max.sortOrder ?? 0) + 1;

  const pipeline = await prisma.dashboardPipeline.create({
    data: {
      workspaceId,
      sectionId: input.sectionId,
      name: input.name,
      description: input.description,
      metricType: input.metricType,
      displayType: input.displayType,
      filtersJson: input.filtersJson as any,
      segmentsJson: input.segmentsJson ? (input.segmentsJson as any) : undefined,
      filterLogic: input.filterLogic,
      visibilityType: input.visibilityType,
      clickAction: input.clickAction,
      sortOrder: input.sortOrder || nextOrder,
      ownerUserId: actor.id,
      createdById: actor.id,
      shares: input.shares
        ? {
            create: input.shares.map((s: any) => ({
              workspaceId,
              shareType: s.shareType,
              ...(s.shareType === 'USER' && { targetUserId: s.targetId }),
              ...(s.shareType === 'ROLE' && { targetRoleId: s.targetId }),
              ...(s.shareType === 'OFFICE' && { targetOfficeId: s.targetId }),
              ...(s.shareType === 'DEPARTMENT' && { targetDepartmentId: s.targetId }),
            })),
          }
        : undefined,
    },
    include: {
      shares: true,
    },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    pipelineId: pipeline.id,
    action: 'PIPELINE_CREATED',
    newValue: { name: pipeline.name, metricType: pipeline.metricType },
  });

  return pipeline;
};

export const updatePipeline = async (
  workspaceId: string,
  pipelineId: string,
  actor: RequestActor,
  input: UpdatePipelineInput,
) => {
  const existing = await prisma.dashboardPipeline.findFirst({
    where: { id: pipelineId, workspaceId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Pipeline not found');
  }

  if (input.shares) {
    await prisma.dashboardPipelineShare.deleteMany({
      where: { pipelineId },
    });
  }

  const updated = await prisma.dashboardPipeline.update({
    where: { id: pipelineId },
    data: {
      sectionId: input.sectionId,
      name: input.name,
      description: input.description,
      metricType: input.metricType,
      displayType: input.displayType,
      filtersJson: input.filtersJson ? (input.filtersJson as any) : undefined,
      segmentsJson: input.segmentsJson ? (input.segmentsJson as any) : undefined,
      filterLogic: input.filterLogic,
      visibilityType: input.visibilityType,
      status: input.status,
      clickAction: input.clickAction,
      sortOrder: input.sortOrder,
      shares: input.shares
        ? {
            create: input.shares.map((s: any) => ({
              workspaceId,
              shareType: s.shareType,
              ...(s.shareType === 'USER' && { targetUserId: s.targetId }),
              ...(s.shareType === 'ROLE' && { targetRoleId: s.targetId }),
              ...(s.shareType === 'OFFICE' && { targetOfficeId: s.targetId }),
              ...(s.shareType === 'DEPARTMENT' && { targetDepartmentId: s.targetId }),
            })),
          }
        : undefined,
    },
    include: {
      shares: true,
    },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    pipelineId,
    action: 'PIPELINE_UPDATED',
    previousValue: { name: existing.name, metricType: existing.metricType },
    newValue: { name: updated.name, metricType: updated.metricType },
  });

  return updated;
};

export const deletePipeline = async (workspaceId: string, pipelineId: string, actor: RequestActor) => {
  const pipeline = await prisma.dashboardPipeline.findFirst({
    where: { id: pipelineId, workspaceId, deletedAt: null },
  });

  if (!pipeline) {
    throw new Error('Pipeline not found');
  }

  await prisma.dashboardPipeline.update({
    where: { id: pipelineId },
    data: { deletedAt: new Date() },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    pipelineId,
    action: 'PIPELINE_DELETED',
    previousValue: { name: pipeline.name },
  });

  return { success: true };
};

export const duplicatePipeline = async (workspaceId: string, pipelineId: string, actor: RequestActor) => {
  const existing = await prisma.dashboardPipeline.findFirst({
    where: { id: pipelineId, workspaceId, deletedAt: null },
    include: { shares: true },
  });

  if (!existing) {
    throw new Error('Pipeline not found');
  }

  const duplicated = await prisma.dashboardPipeline.create({
    data: {
      workspaceId,
      sectionId: existing.sectionId,
      name: `${existing.name} (Copy)`,
      description: existing.description,
      metricType: existing.metricType,
      displayType: existing.displayType,
      filtersJson: existing.filtersJson as any,
      filterLogic: existing.filterLogic,
      visibilityType: 'PRIVATE',
      clickAction: existing.clickAction,
      sortOrder: existing.sortOrder + 1,
      ownerUserId: actor.id,
      createdById: actor.id,
    },
  });

  await logPipelineAudit(workspaceId, actor.id, {
    pipelineId: duplicated.id,
    action: 'PIPELINE_DUPLICATED',
    newValue: { originalId: pipelineId, newName: duplicated.name },
  });

  return duplicated;
};

export const previewPipeline = async (workspaceId: string, actor: RequestActor, input: PreviewPipelineInput) => {
  const scopedLeadAccess = await buildAccessWhere(workspaceId, actor);

  const metrics = await computePipelineMetrics(
    workspaceId,
    input.filtersJson as unknown as FilterCondition[],
    input.filterLogic as 'AND' | 'OR',
    input.metricType,
    scopedLeadAccess,
    (input as any).displayType,
    (input as any).segmentsJson,
  );

  const finalWhere = buildCustomPipelineWhere(
    input.filtersJson as unknown as FilterCondition[],
    input.filterLogic as 'AND' | 'OR',
    scopedLeadAccess,
  );

  const sampleLeads = await prisma.lead.findMany({
    where: { workspaceId, ...finalWhere },
    take: 5,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      expectedRevenue: true,
      createdAt: true,
      stage: { select: { id: true, name: true, color: true } },
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    metrics,
    sampleLeads,
    appliedFiltersCount: input.filtersJson.length,
  };
};

export const getPipelineResults = async (
  workspaceId: string,
  pipelineId: string,
  actor: RequestActor,
  page = 1,
  limit = 25,
) => {
  const pipeline = await prisma.dashboardPipeline.findFirst({
    where: { id: pipelineId, workspaceId, deletedAt: null },
  });

  if (!pipeline) {
    throw new Error('Pipeline not found');
  }

  const scopedLeadAccess = await buildAccessWhere(workspaceId, actor);
  const finalWhere = buildCustomPipelineWhere(
    pipeline.filtersJson as unknown as FilterCondition[],
    pipeline.filterLogic as 'AND' | 'OR',
    scopedLeadAccess,
  );

  const skip = (page - 1) * limit;

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where: { workspaceId, ...finalWhere } }),
    prisma.lead.findMany({
      where: { workspaceId, ...finalWhere },
      skip,
      take: limit,
      include: {
        stage: true,
        substage: true,
        source: true,
        assignedTo: { select: { id: true, name: true, email: true, profileImageUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    pipeline,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    leads,
  };
};

// ----------------------------------------------------
// Metric Calculator Helper
// ----------------------------------------------------
const computePipelineMetrics = async (
  workspaceId: string,
  filtersJson: FilterCondition[],
  filterLogic: 'AND' | 'OR',
  metricType: string,
  leadAccessScope: Prisma.LeadWhereInput,
  displayType?: string,
  segmentsJson?: any[],
) => {
  if (displayType === 'PIE_CHART' && Array.isArray(segmentsJson) && segmentsJson.length > 0) {
    const DEFAULT_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#6366F1', '#14B8A6'];
    const segments = await Promise.all(
      segmentsJson.map(async (seg: any, idx: number) => {
        const segFilters = seg.filtersJson || [];
        const segLogic = seg.filterLogic || 'AND';
        const segMetric = seg.metricType || 'LEAD_COUNT';
        const segWhere = buildCustomPipelineWhere(segFilters, segLogic, leadAccessScope);
        const segBaseWhere: Prisma.LeadWhereInput = { workspaceId, deletedAt: null, ...segWhere };

        let val = 0;
        if (segMetric === 'TOTAL_EXPECTED_REVENUE') {
          const agg = await prisma.lead.aggregate({ where: segBaseWhere, _sum: { expectedRevenue: true } });
          val = Number(agg._sum.expectedRevenue || 0);
        } else if (segMetric === 'TOTAL_CLOSED_REVENUE') {
          const agg = await prisma.lead.aggregate({ where: segBaseWhere, _sum: { generatedRevenue: true } });
          val = Number(agg._sum.generatedRevenue || 0);
        } else if (segMetric === 'AVERAGE_REVENUE') {
          const agg = await prisma.lead.aggregate({ where: segBaseWhere, _avg: { expectedRevenue: true } });
          val = Math.round(Number(agg._avg.expectedRevenue || 0));
        } else {
          val = await prisma.lead.count({ where: segBaseWhere });
        }

        return {
          label: seg.label || `Segment ${idx + 1}`,
          value: val,
          color: seg.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
          metricType: segMetric,
        };
      }),
    );

    const totalVal = segments.reduce((acc, s) => acc + s.value, 0);

    return {
      count: totalVal,
      totalExpectedRevenue: 0,
      totalClosedRevenue: 0,
      averageRevenue: 0,
      secondaryMetric: 0,
      stageBreakdown: [],
      segments,
      lastRefreshedAt: new Date().toISOString(),
    };
  }
  const finalWhere = buildCustomPipelineWhere(filtersJson, filterLogic, leadAccessScope);
  const baseWhere: Prisma.LeadWhereInput = { workspaceId, deletedAt: null, ...finalWhere };

  logger.info('[Dashboard Preview Request]', {
    workspaceId,
    metricType,
    filterLogic,
    rawFiltersCount: filtersJson?.length || 0,
    baseWhere: JSON.stringify(baseWhere),
  });

  const [leadCount, revenueAggregate] = await Promise.all([
    prisma.lead.count({ where: baseWhere }),
    prisma.lead.aggregate({
      where: baseWhere,
      _sum: { expectedRevenue: true, generatedRevenue: true },
      _avg: { expectedRevenue: true },
    }),
  ]);

  logger.info('[Dashboard Preview Result]', {
    workspaceId,
    metricType,
    matchedRecordCount: leadCount,
    totalExpectedRevenue: revenueAggregate._sum.expectedRevenue || 0,
  });

  let secondaryMetric = 0;
  let stageBreakdown: Array<{ stageId: string; name: string; color: string; count: number }> = [];

  if (metricType === 'CONVERSION_RATE') {
    const closedCount = await prisma.lead.count({
      where: { AND: [baseWhere, { isClosed: true, isLOB: false }] },
    });
    secondaryMetric = leadCount > 0 ? Number(((closedCount / leadCount) * 100).toFixed(1)) : 0;
  } else if (metricType === 'LOB_COUNT') {
    secondaryMetric = await prisma.lead.count({
      where: { AND: [baseWhere, { isLOB: true }] },
    });
  } else if (metricType === 'OVERDUE_FOLLOWUP_COUNT') {
    secondaryMetric = await prisma.lead.count({
      where: {
        AND: [
          baseWhere,
          {
            followUps: {
              some: {
                status: 'PENDING',
                scheduledAt: { lt: new Date() },
              },
            },
          },
        ],
      },
    });
  } else if (metricType === 'STAGE_DISTRIBUTION') {
    const stageGroups = await prisma.lead.groupBy({
      by: ['stageId'],
      where: baseWhere,
      _count: { id: true },
    });

    const stages = await prisma.leadStage.findMany({
      where: { workspaceId },
      select: { id: true, name: true, color: true },
    });

    const stageMap = new Map<string, { id: string; name: string; color: string }>(
      stages.map((s) => [s.id, s]),
    );

    stageBreakdown = stageGroups
      .map((g) => {
        const stageInfo = stageMap.get(g.stageId || '');
        return {
          stageId: g.stageId || 'UNASSIGNED',
          name: stageInfo?.name || 'Unassigned',
          color: stageInfo?.color || '#94a3b8',
          count: g._count.id,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  return {
    count: leadCount,
    totalExpectedRevenue: revenueAggregate._sum.expectedRevenue || 0,
    totalClosedRevenue: revenueAggregate._sum.generatedRevenue || 0,
    averageRevenue: Math.round(revenueAggregate._avg.expectedRevenue || 0),
    secondaryMetric,
    stageBreakdown,
    lastRefreshedAt: new Date().toISOString(),
  };
};

const logPipelineAudit = async (
  workspaceId: string,
  performedById: string,
  payload: {
    sectionId?: string;
    pipelineId?: string;
    action: string;
    previousValue?: any;
    newValue?: any;
  },
) => {
  try {
    await prisma.dashboardPipelineAudit.create({
      data: {
        workspaceId,
        performedById,
        sectionId: payload.sectionId,
        pipelineId: payload.pipelineId,
        action: payload.action,
        previousValue: payload.previousValue ? (payload.previousValue as any) : undefined,
        newValue: payload.newValue ? (payload.newValue as any) : undefined,
      },
    });
  } catch (err) {
    logger.error('Failed to log pipeline audit', { err, payload });
  }
};
