import prisma from '../../config/prisma';
import { normalizeFollowUpType } from '../../constants/followUpType';

export const ensureLeadApprovalSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      COUNT(*) FILTER (WHERE table_name = 'lead_stage_approvals') > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('lead_stage_approvals')
  `;

  return Boolean(rows[0]?.ready);
};

export const getRolePermissionKeys = async (roleId: string): Promise<string[]> => {
  const rows = await (prisma as any).rolePermission.findMany({
    where: { roleId },
    include: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return rows.map((row: any) => row.permission.key);
};

export const findLeadScoped = async (workspaceId: string, leadId: string) =>
  (prisma as any).lead.findFirst({
    where: {
      id: leadId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      stage: {
        select: {
          id: true,
          name: true,
          isLOB: true,
          isClosed: true,
        },
      },
      lifecycle: {
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
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          supervisorId: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
        },
      },
    },
  });

export const findStageById = async (workspaceId: string, stageId: string) =>
  prisma.leadStage.findFirst({
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

export const findPendingApprovalForLead = async (workspaceId: string, leadId: string) =>
  (prisma as any).leadStageApproval.findFirst({
    where: {
      workspaceId,
      leadId,
      status: 'PENDING',
    },
    orderBy: { createdAt: 'desc' },
  });

export const findActiveUserById = async (workspaceId: string, userId: string) =>
  (prisma as any).user.findFirst({
    where: {
      id: userId,
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      supervisorId: true,
    },
  });

export const clearLeadPendingApprovalState = async (leadId: string) =>
  (prisma as any).lead.update({
    where: { id: leadId },
    data: {
      approvalState: 'NONE',
      pendingApprovalToStageId: null,
      pendingApprovalRequestedAt: null,
    },
    select: {
      id: true,
      approvalState: true,
      pendingApprovalToStageId: true,
      pendingApprovalRequestedAt: true,
    },
  });

export const findApproverCandidates = async (workspaceId: string) =>
  prisma.user.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      isActive: true,
      roleId: { not: null },
    },
    include: {
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

export const createApprovalRequest = async (input: {
  workspaceId: string;
  leadId: string;
  fromStageId: string;
  toStageId: string;
  requestedById: string;
  assignedToId?: string | null;
  requestData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) =>
  prisma.$transaction(async (tx: any) => {
    const approval = await (tx as any).leadStageApproval.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        fromStageId: input.fromStageId,
        toStageId: input.toStageId,
        requestedById: input.requestedById,
        assignedToId: input.assignedToId ?? null,
        status: 'PENDING',
        requestData: input.requestData ?? {},
      },
      include: {
        fromStage: { select: { id: true, name: true } },
        toStage: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, username: true, email: true } },
        assignedTo: { select: { id: true, name: true, username: true, email: true } },
      },
    });

    await (tx as any).lead.update({
      where: { id: input.leadId },
      data: {
        approvalState: 'PENDING',
        pendingApprovalToStageId: input.toStageId,
        pendingApprovalRequestedAt: new Date(),
      },
    });

    await (tx as any).leadActivity.create({
      data: {
        leadId: input.leadId,
        performedById: input.requestedById,
        workspaceId: input.workspaceId,
        action: 'LEAD_STAGE_APPROVAL_REQUESTED',
        metadata: {
          fromStageId: input.fromStageId,
          toStageId: input.toStageId,
          assignedToId: input.assignedToId ?? null,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.requestedById,
        workspaceId: input.workspaceId,
        action: 'LEAD_STAGE_APPROVAL_REQUESTED',
        entityType: 'Lead',
        entityId: input.leadId,
        details: {
          approvalId: approval.id,
          fromStageId: input.fromStageId,
          toStageId: input.toStageId,
          assignedToId: input.assignedToId ?? null,
          requestData: input.requestData ?? {},
        } as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return approval;
  });

export const listApprovals = async (where: any, skip: number, take: number) => {
  const [total, rows] = await Promise.all([
    (prisma as any).leadStageApproval.count({ where }),
    (prisma as any).leadStageApproval.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            approvalState: true,
          },
        },
        fromStage: { select: { id: true, name: true } },
        toStage: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, username: true, email: true } },
        assignedTo: { select: { id: true, name: true, username: true, email: true } },
        approvedBy: { select: { id: true, name: true, username: true, email: true } },
      },
    }),
  ]);

  return { total, rows };
};

export const getApprovalById = async (workspaceId: string, id: string) =>
  (prisma as any).leadStageApproval.findFirst({
    where: {
      id,
      workspaceId,
    },
    include: {
      lead: {
        select: {
          id: true,
          workspaceId: true,
          deletedAt: true,
          stage: {
            select: {
              id: true,
              name: true,
              isLOB: true,
              isClosed: true,
            },
          },
          lifecycle: {
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
          },
        },
      },
      fromStage: { select: { id: true, name: true } },
      toStage: { select: { id: true, name: true, isLOB: true, isClosed: true } },
      requestedBy: { select: { id: true, name: true, username: true, email: true } },
      assignedTo: { select: { id: true, name: true, username: true, email: true } },
      approvedBy: { select: { id: true, name: true, username: true, email: true } },
    },
  });

export const processApproval = async (input: {
  workspaceId: string;
  approvalId: string;
  action: 'APPROVE' | 'DENY';
  comment: string;
  approvedById: string;
  leadUpdateData?: Record<string, unknown>;
  requestData?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}) =>
  prisma.$transaction(async (tx: any) => {
    const approval = await (tx as any).leadStageApproval.findUnique({
      where: { id: input.approvalId },
      include: {
        lead: {
          select: {
            id: true,
            workspaceId: true,
            assignedToId: true,
          },
        },
        fromStage: { select: { id: true, name: true } },
        toStage: {
          select: {
            id: true,
            isLOB: true,
          },
        },
      },
    });

    if (!approval || approval.workspaceId !== input.workspaceId) {
      return null;
    }

    if (approval.status !== 'PENDING') {
      throw new Error('ALREADY_PROCESSED');
    }

    if (input.action === 'APPROVE' && input.leadUpdateData) {
      await (tx as any).lead.update({
        where: { id: approval.leadId },
        data: input.leadUpdateData,
      });

      const requestData = input.requestData ?? {};
      const nextFollowUpAt =
        typeof requestData.nextFollowUpAt === 'string' && requestData.nextFollowUpAt.trim()
          ? new Date(requestData.nextFollowUpAt)
          : null;

      if (nextFollowUpAt && !Number.isNaN(nextFollowUpAt.getTime())) {
        await (tx as any).followUp.create({
          data: {
            leadId: approval.leadId,
            workspaceId: input.workspaceId,
            userId: approval.lead.assignedToId ?? approval.approvedById ?? input.approvedById,
            type: normalizeFollowUpType((requestData as { nextFollowUpType?: unknown }).nextFollowUpType),
            description:
              typeof requestData.followUpDescription === 'string' && requestData.followUpDescription.trim()
                ? requestData.followUpDescription.trim()
                : 'Follow-up created from approved stage transition',
            status: 'PENDING',
            scheduledAt: nextFollowUpAt,
          },
        });
      }

      if (approval.toStage?.isLOB) {
        const snapshotPrevId =
          typeof requestData.previousStageId === 'string' && requestData.previousStageId.trim()
            ? requestData.previousStageId.trim()
            : approval.fromStageId ?? null;
        const snapshotPrevName =
          typeof requestData.previousStageName === 'string' && requestData.previousStageName.trim()
            ? requestData.previousStageName.trim()
            : approval.fromStage?.name?.trim() || null;

        await (tx as any).leadLOBLog.create({
          data: {
            leadId: approval.leadId,
            workspaceId: input.workspaceId,
            reasonId:
              typeof requestData.reasonId === 'string' && requestData.reasonId.trim()
                ? requestData.reasonId.trim()
                : 'approval-auto-lob',
            remarks:
              typeof requestData.remarks === 'string' && requestData.remarks.trim()
                ? requestData.remarks.trim()
                : null,
            previousStageId: snapshotPrevId,
            previousStageName: snapshotPrevName,
            changedById: input.approvedById,
          },
        });
      }
    } else {
      await (tx as any).lead.update({
        where: { id: approval.leadId },
        data: {
          approvalState: 'NONE',
          pendingApprovalToStageId: null,
          pendingApprovalRequestedAt: null,
        },
      });
    }

    const updatedApproval = await (tx as any).leadStageApproval.update({
      where: { id: input.approvalId },
      data: {
        status: input.action === 'APPROVE' ? 'APPROVED' : 'DENIED',
        comment: input.comment.trim(),
        approvedById: input.approvedById,
        approvedAt: new Date(),
      },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
          },
        },
        fromStage: { select: { id: true, name: true } },
        toStage: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, username: true, email: true } },
        approvedBy: { select: { id: true, name: true, username: true, email: true } },
      },
    });

    await (tx as any).leadActivity.create({
      data: {
        leadId: approval.leadId,
        performedById: input.approvedById,
        workspaceId: input.workspaceId,
        action: input.action === 'APPROVE' ? 'LEAD_STAGE_APPROVED' : 'LEAD_STAGE_DENIED',
        metadata: {
          approvalId: input.approvalId,
          comment: input.comment.trim(),
          fromStageId: approval.fromStageId,
          toStageId: approval.toStageId,
          requestData: input.requestData ?? {},
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.approvedById,
        workspaceId: input.workspaceId,
        action: input.action === 'APPROVE' ? 'LEAD_STAGE_APPROVAL_APPROVED' : 'LEAD_STAGE_APPROVAL_DENIED',
        entityType: 'Lead',
        entityId: approval.leadId,
        details: {
          approvalId: input.approvalId,
          fromStageId: approval.fromStageId,
          toStageId: approval.toStageId,
          comment: input.comment.trim(),
          requestData: input.requestData ?? {},
        } as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return updatedApproval;
  });
