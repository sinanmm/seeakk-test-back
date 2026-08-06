import prisma from '../../config/prisma';
import { formatPhoneStr } from '../../utils/phoneUtils';
import type { InitiateCallInput, SaveCallOutcomeInput } from './callTracking.validation';

const createError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const getLocalDateStr = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const initiateCallSession = async (
  workspaceId: string,
  leadId: string,
  userId: string,
  input: InitiateCallInput,
) => {
  const lead = await (prisma as any).lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      phone: true,
      assignedToId: true,
      stageId: true,
      substageId: true,
    },
  });

  if (!lead) {
    throw createError('Lead not found or access denied', 404);
  }

  if (!lead.phone || !lead.phone.trim()) {
    throw createError('Lead does not have a valid phone number for dialing', 400);
  }

  const rawPhone = lead.phone.trim();
  const cleanPhone = rawPhone.replace(/[^\d+]/g, '');
  const localCallDate = getLocalDateStr(new Date());

  const callSession = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId,
      leadId,
      initiatedById: userId,
      assignedUserId: lead.assignedToId,
      phoneNumberSnapshot: rawPhone,
      sourceContext: input.sourceContext || 'ALL_LEADS',
      followUpId: input.followUpId || null,
      localCallDate,
      status: 'INITIATED',
      provider: 'DEVICE_DIALER',
    },
  });

  await (prisma as any).leadActivity.create({
    data: {
      leadId,
      performedById: userId,
      workspaceId,
      action: 'CALL_INITIATED',
      metadata: {
        callSessionId: callSession.id,
        phone: rawPhone,
        sourceContext: input.sourceContext,
        followUpId: input.followUpId,
      },
    },
  });

  return {
    callSessionId: callSession.id,
    leadId: lead.id,
    leadName: lead.name,
    phone: rawPhone,
    cleanPhone,
    telUrl: `tel:${cleanPhone}`,
    initiatedAt: callSession.initiatedAt,
  };
};

export const getActiveCallSession = async (
  workspaceId: string,
  leadId: string,
  userId: string,
) => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const callSession = await (prisma as any).leadCallSession.findFirst({
    where: {
      workspaceId,
      leadId,
      initiatedById: userId,
      status: 'INITIATED',
      initiatedAt: { gte: twoHoursAgo },
    },
    orderBy: { initiatedAt: 'desc' },
    include: {
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          stage: { select: { id: true, name: true, color: true } },
          substage: { select: { id: true, name: true } },
        },
      },
    },
  });

  return callSession;
};

export const saveCallOutcome = async (
  workspaceId: string,
  leadId: string,
  userId: string,
  input: SaveCallOutcomeInput,
) => {
  return await (prisma as any).$transaction(async (tx: any) => {
    const callSession = await tx.leadCallSession.findFirst({
      where: {
        id: input.callSessionId,
        workspaceId,
        leadId,
      },
    });

    if (!callSession) {
      throw createError('Call session not found', 404);
    }

    const lead = await tx.lead.findFirst({
      where: { id: leadId, workspaceId, deletedAt: null },
      include: {
        stage: true,
        substage: true,
      },
    });

    if (!lead) {
      throw createError('Lead not found', 404);
    }

    let selectedSubstage: any = null;
    let targetStage: any = null;
    let approvalRequestId: string | null = null;
    let stageRuleSubmissionId: string | null = null;
    let isStageChanged = false;
    let isApprovalTriggered = false;

    if (input.substageId) {
      selectedSubstage = await tx.leadSubstage.findFirst({
        where: { id: input.substageId, workspaceId, deletedAt: null },
        include: {
          leadStage: true,
        },
      });

      if (!selectedSubstage) {
        throw createError('Selected substage not found or inactive', 400);
      }

      targetStage = selectedSubstage.leadStage;

      const effectiveReasonId = input.lobReasonId || input.reasonId;
      const effectiveRemarks = input.lobRemarks;
      const effectiveExitRemarks = input.lobExitReason || input.lobReturnRemarks || input.lobRemarks;
      const isCurrentLOB = Boolean(lead.stage?.isLOB || lead.isLOB);

      // Check if stage transition is needed
      if (targetStage && targetStage.id !== lead.stageId) {
        if (targetStage.isLOB) {
          if (!effectiveReasonId) {
            throw createError('LOB reason is required when moving to an LOB stage', 400);
          }
          const validReason = await tx.lOBReason.findFirst({
            where: { id: effectiveReasonId, workspaceId, status: 'ACTIVE' },
          });
          if (!validReason) {
            throw createError('Selected LOB reason is invalid or inactive', 400);
          }
        }

        if (isCurrentLOB && !targetStage.isLOB) {
          if (!effectiveExitRemarks || !effectiveExitRemarks.trim()) {
            throw createError('LOB return remark is required when returning a lead from LOB', 400);
          }
        }

        // Check if target stage requires approval
        if (targetStage.isApprovalRequired) {
          // Create approval request
          const approval = await tx.leadStageApproval.create({
            data: {
              workspaceId,
              leadId,
              fromStageId: lead.stageId || targetStage.id,
              toStageId: targetStage.id,
              requestedById: userId,
              assignedToId: lead.assignedToId || userId,
              status: 'PENDING',
              comment: input.outcomeNotes || `Requested via Call Outcome (${selectedSubstage.name})`,
              requestData: {
                substageId: selectedSubstage.id,
                substageName: selectedSubstage.name,
                callSessionId: callSession.id,
                lobReasonId: effectiveReasonId || null,
                lobRemarks: effectiveRemarks || null,
                lobExitReason: effectiveExitRemarks || null,
              },
            },
          });

          await tx.lead.update({
            where: { id: leadId },
            data: {
              approvalState: 'PENDING',
              pendingApprovalToStageId: targetStage.id,
              pendingApprovalRequestedAt: new Date(),
            },
          });

          approvalRequestId = approval.id;
          isApprovalTriggered = true;
        } else {
          // Handle stage rules if present
          if (input.stageRuleValues && input.stageRuleValues.length > 0) {
            const inputsToSave = input.stageRuleValues.map((v) => ({
              leadId,
              ruleId: v.ruleId,
              value: v.value,
            }));
            await tx.leadStageInput.createMany({ data: inputsToSave });
            stageRuleSubmissionId = `submission-${Date.now()}`;
          }

          // Direct Stage & Substage Update
          await tx.lead.update({
            where: { id: leadId },
            data: {
              stageId: targetStage.id,
              substageId: selectedSubstage.id,
              stageEnteredAt: new Date(),
              isClosed: targetStage.isClosed,
              isLOB: targetStage.isLOB,
            },
          });

          // Create LOB Log if target stage is LOB
          if (targetStage.isLOB && effectiveReasonId) {
            await tx.leadLOBLog.create({
              data: {
                leadId,
                workspaceId,
                reasonId: effectiveReasonId,
                remarks: effectiveRemarks || input.outcomeNotes || null,
                previousStageId: lead.stageId || null,
                previousStageName: lead.stage?.name || null,
                changedById: userId,
              },
            });
          }

          // Record Stage History with valid model fields (no unsupported 'reason' field)
          await tx.leadStageHistory.create({
            data: {
              leadId,
              workspaceId,
              fromStageId: lead.stageId || null,
              fromStageName: lead.stage?.name || null,
              toStageId: targetStage.id,
              toStageName: targetStage.name || null,
              changedById: userId,
            },
          });

          isStageChanged = true;
        }
      } else {
        // Stage remains same, just update substage
        await tx.lead.update({
          where: { id: leadId },
          data: { substageId: selectedSubstage.id },
        });
      }
    }

    // Create Call Outcome record
    const outcome = await tx.leadCallOutcome.create({
      data: {
        callSessionId: callSession.id,
        workspaceId,
        leadId,
        userId,
        connectionStatus: input.connectionStatus,
        outcomeNotes: input.outcomeNotes || null,
        substageId: selectedSubstage?.id || null,
        previousStageId: lead.stageId,
        targetStageId: targetStage?.id || lead.stageId,
        previousSubstageId: lead.substageId,
        approvalRequestId,
        stageRuleSubmissionId,
        followUpId: callSession.followUpId,
        callPriority: input.callPriority || 'MEDIUM',
        submittedAt: new Date(),
      },
    });

    // Mark Call Session as COMPLETED
    await tx.leadCallSession.update({
      where: { id: callSession.id },
      data: {
        status: 'COMPLETED',
        returnedAt: new Date(),
      },
    });

    // Create FollowUp if requested
    let createdFollowUpId: string | null = null;
    if (input.followUpRequired && input.nextFollowUpDate) {
      const scheduledAt = new Date(`${input.nextFollowUpDate}T${input.nextFollowUpTime || '10:00'}:00`);
      const newFollowUp = await tx.followUp.create({
        data: {
          workspaceId,
          leadId,
          userId: lead.assignedToId || userId,
          type: input.followUpType || 'CALL',
          description: input.followUpDescription || input.outcomeNotes || 'Follow-up after call',
          scheduledAt: isNaN(scheduledAt.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000) : scheduledAt,
          status: 'PENDING',
        },
      });
      createdFollowUpId = newFollowUp.id;
    }

    // Log Lead Activity
    await tx.leadActivity.create({
      data: {
        leadId,
        performedById: userId,
        workspaceId,
        action: 'CALL_OUTCOME_SUBMITTED',
        metadata: {
          callSessionId: callSession.id,
          outcomeId: outcome.id,
          connectionStatus: input.connectionStatus,
          substageName: selectedSubstage?.name,
          targetStageName: targetStage?.name,
          isStageChanged,
          isApprovalTriggered,
          callPriority: input.callPriority,
          followUpCreated: Boolean(createdFollowUpId),
        },
      },
    });

    return {
      success: true,
      outcomeId: outcome.id,
      callSessionId: callSession.id,
      connectionStatus: input.connectionStatus,
      substageName: selectedSubstage?.name || null,
      targetStageName: targetStage?.name || lead.stage?.name || null,
      isStageChanged,
      isApprovalTriggered,
      createdFollowUpId,
      message: isApprovalTriggered
        ? 'Call outcome saved. Stage change submitted for supervisor approval.'
        : 'Call outcome saved successfully.',
    };
  });
};
