import prisma from '../../config/prisma';

export const ensureLOBAnalysisSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    WITH tables_ok AS (
      SELECT
        COUNT(*) FILTER (WHERE table_name = 'leads') > 0
        AND COUNT(*) FILTER (WHERE table_name = 'lead_lob_logs') > 0
        AND COUNT(*) FILTER (WHERE table_name = 'lob_reasons') > 0
        AND COUNT(*) FILTER (WHERE table_name = 'audit_logs') > 0
        AND COUNT(*) FILTER (WHERE table_name = 'lead_stage_approvals') > 0 AS ready
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('leads', 'lead_lob_logs', 'lob_reasons', 'audit_logs', 'lead_stage_approvals')
    ),
    lob_log_columns_ok AS (
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns c1
          WHERE c1.table_schema = 'public'
            AND c1.table_name = 'lead_lob_logs'
            AND c1.column_name = 'previousStageId'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns c2
          WHERE c2.table_schema = 'public'
            AND c2.table_name = 'lead_lob_logs'
            AND c2.column_name = 'previousStageName'
        ) AS ready
    )
    SELECT tables_ok.ready AND lob_log_columns_ok.ready AS ready
    FROM tables_ok
    CROSS JOIN lob_log_columns_ok
  `;

  return Boolean(rows[0]?.ready);
};

export const findLOBEvents = async (workspaceId: string, changedAtRange?: { gte?: Date; lte?: Date }) =>
  (prisma as any).leadLOBLog.findMany({
    where: {
      workspaceId,
      ...(changedAtRange ? { changedAt: changedAtRange } : {}),
      lead: {
        workspaceId,
        deletedAt: null,
      },
    },
    orderBy: [{ changedAt: 'desc' }],
    select: {
      id: true,
      leadId: true,
      reasonId: true,
      remarks: true,
      changedById: true,
      changedAt: true,
      lead: {
        select: {
          id: true,
          name: true,
          assignedToId: true,
          createdAt: true,
          assignedTo: {
            select: {
              id: true,
              name: true,
              username: true,
              email: true,
              officeId: true,
              countryId: true,
              stateId: true,
              districtId: true,
              assignedLocations: {
                select: {
                  locationId: true,
                },
              },
            },
          },
        },
      },
    },
  });

export const countLeadsForAnalytics = async (
  workspaceId: string,
  filters?: {
    createdAt?: { gte?: Date; lte?: Date };
    assignedToId?: string;
  },
) =>
  (prisma as any).lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(filters?.createdAt ? { createdAt: filters.createdAt } : {}),
      ...(filters?.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    },
    select: {
      id: true,
      assignedTo: {
        select: {
          id: true,
          officeId: true,
          countryId: true,
          stateId: true,
          districtId: true,
          assignedLocations: {
            select: {
              locationId: true,
            },
          },
        },
      },
    },
  });

export const findLOBApprovalTransitions = async (workspaceId: string, leadIds: string[]) => {
  if (leadIds.length === 0) return [];

  return (prisma as any).leadStageApproval.findMany({
    where: {
      workspaceId,
      leadId: { in: leadIds },
      status: 'APPROVED',
      toStage: {
        isLOB: true,
      },
    },
    orderBy: [{ approvedAt: 'desc' }],
    select: {
      id: true,
      leadId: true,
      approvedAt: true,
      approvedById: true,
      fromStageId: true,
      fromStage: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const findLeadStageAuditTrail = async (workspaceId: string, leadIds: string[]) => {
  if (leadIds.length === 0) return [];

  return prisma.auditLog.findMany({
    where: {
      workspaceId,
      entityType: 'Lead',
      entityId: { in: leadIds },
      action: {
        in: ['LEAD_CREATED', 'LEAD_STAGE_CHANGED', 'LEAD_LOB_APPLIED'],
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      entityId: true,
      action: true,
      details: true,
      createdAt: true,
    },
  });
};

export const findLOBReasonsByIds = async (workspaceId: string, reasonIds: string[]) => {
  if (reasonIds.length === 0) return [];

  return prisma.lOBReason.findMany({
    where: {
      workspaceId,
      id: {
        in: reasonIds,
      },
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });
};

export const findUsersByIds = async (workspaceId: string, userIds: string[]) => {
  if (userIds.length === 0) return [];

  return prisma.user.findMany({
    where: {
      workspaceId,
      id: {
        in: userIds,
      },
    },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  });
};

export const findWorkspaceStages = async (workspaceId: string) =>
  prisma.leadStage.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });
