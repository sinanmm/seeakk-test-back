import prisma from '../../config/prisma';


export const ensureLeadApprovalSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT COUNT(*) > 0 AS ready
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'lead_stage_approvals'
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
            earnedRevenue: true,
            generatedRevenue: true,
          },
        },
        fromStage: { select: { id: true, name: true, isClosed: true, isLOB: true } },
        toStage: { select: { id: true, name: true, isClosed: true, isLOB: true } },
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

export const syncRevenueTransactionInline = async (tx: any, workspaceId: string, leadId: string, stageId: string | null, actorId: string) => {
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
  earnedRevenue?: number;
  checkNumber?: string;
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
            stageId: true,
          },
        },
        fromStage: { select: { id: true, name: true } },
        toStage: {
          select: {
            id: true,
            isLOB: true,
            isClosed: true,
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

    if (approval.type === 'ADVANCE_PAYMENT') {
      const reqData = approval.requestData as any;
      const advancePaymentId = reqData?.advancePaymentId;
      if (!advancePaymentId) {
        throw new Error('MISSING_ADVANCE_PAYMENT_ID');
      }

      if (input.action === 'APPROVE') {
        if (!input.checkNumber || !input.checkNumber.trim()) {
          throw new Error('CHECK_NUMBER_REQUIRED');
        }

        await tx.advancePayment.update({
          where: { id: advancePaymentId },
          data: {
            status: 'APPROVED',
            checkNumber: input.checkNumber.trim(),
            approvedById: input.approvedById,
            approvedAt: new Date(),
          },
        });

        await syncRevenueTransactionInline(tx, input.workspaceId, approval.leadId, approval.lead.stageId, input.approvedById);
      } else {
        await tx.advancePayment.update({
          where: { id: advancePaymentId },
          data: {
            status: 'REJECTED',
            rejectedById: input.approvedById,
            rejectedAt: new Date(),
            rejectionReason: input.comment || null,
          },
        });
      }
    } else if (input.action === 'APPROVE' && input.leadUpdateData) {
      const isClosedWonStage = Boolean(approval.toStage?.isClosed && !approval.toStage?.isLOB);
      const earnedRevenue =
        isClosedWonStage && typeof input.earnedRevenue === 'number' ? input.earnedRevenue : undefined;

      const finalLeadUpdateData = {
        ...input.leadUpdateData,
        ...(earnedRevenue !== undefined
          ? {
              earnedRevenue,
              revenueApprovedById: input.approvedById,
              revenueApprovedAt: new Date(),
              generatedRevenue: earnedRevenue,
            }
          : {}),
      };

      await (tx as any).lead.update({
        where: { id: approval.leadId },
        data: finalLeadUpdateData,
      });

      if (isClosedWonStage) {
        await syncRevenueTransactionInline(tx, input.workspaceId, approval.leadId, approval.toStageId, input.approvedById);
      }

      const requestData = input.requestData ?? {};
      // NOTE: Follow-up creation and validation are completely decoupled from stage approvals.
      // We no longer read nextFollowUpAt from requestData to create a follow-up here.

      if (approval.toStage?.isLOB) {
        await (tx as any).followUp.updateMany({
          where: {
            leadId: approval.leadId,
            workspaceId: input.workspaceId,
            status: 'PENDING',
          },
          data: {
            status: 'CANCELLED',
            completionDescription: 'Superseded by LOB Workflow',
          },
        });

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

