import path from 'path';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
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

  let activeProvider = 'DEVICE_DIALER';
  let providerCallId: string | undefined;
  let resultTelUrl = `tel:${cleanPhone}`;

  try {
    const { initiateProviderCall } = await import('../telephony/telephony.service');
    const { activeProvider: pKey, callResult } = await initiateProviderCall(
      workspaceId,
      leadId,
      userId,
      cleanPhone,
      input.sourceContext,
    );
    activeProvider = pKey;
    providerCallId = callResult.providerCallId;
    if (callResult.telUrl) {
      resultTelUrl = callResult.telUrl;
    }
  } catch (err) {
    // Fallback to built-in device dialer if telephony integration initialization encounters non-fatal notice
  }

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
      provider: activeProvider,
      providerCallId: providerCallId || null,
      toNumber: cleanPhone,
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
        provider: activeProvider,
      },
    },
  });

  return {
    callSessionId: callSession.id,
    leadId: lead.id,
    leadName: lead.name,
    phone: rawPhone,
    cleanPhone,
    telUrl: resultTelUrl,
    activeProvider,
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
    } else if (input.targetStageId) {
      targetStage = await tx.leadStage.findFirst({
        where: { id: input.targetStageId, workspaceId, deletedAt: null, status: 'ACTIVE' },
      });

      if (!targetStage) {
        throw createError('Selected lead stage not found or inactive', 400);
      }
    }

    if (targetStage) {
      const effectiveReasonId = input.lobReasonId || input.reasonId;
      const effectiveRemarks = input.lobRemarks;
      const effectiveExitRemarks = input.lobExitReason || input.lobReturnRemarks || input.lobRemarks;
      const isCurrentLOB = Boolean(lead.stage?.isLOB || lead.isLOB);

      // Check if stage transition is needed
      if (targetStage.id !== lead.stageId) {
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
          let lobReasonName: string | null = null;
          if (effectiveReasonId) {
            const reasonRec = await tx.lOBReason.findFirst({
              where: { id: effectiveReasonId, workspaceId },
              select: { name: true },
            });
            lobReasonName = reasonRec?.name || null;
          }

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
              comment: input.outcomeNotes || `Requested via Call Outcome (${selectedSubstage?.name || targetStage.name})`,
              requestData: {
                substageId: selectedSubstage?.id || null,
                substageName: selectedSubstage?.name || null,
                targetStageId: targetStage.id,
                targetStageName: targetStage.name,
                callSessionId: callSession.id,
                reasonId: effectiveReasonId || null,
                lobReasonId: effectiveReasonId || null,
                lobReason: lobReasonName,
                lobReasonName,
                remarks: effectiveRemarks || input.outcomeNotes || null,
                lobRemarks: effectiveRemarks || input.outcomeNotes || null,
                lobDescription: effectiveRemarks || input.outcomeNotes || null,
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
            const inputsToSave = input.stageRuleValues.map((v: any) => ({
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
              substageId: selectedSubstage?.id || null,
              stageEnteredAt: new Date(),
              isClosed: targetStage.isClosed,
              isLOB: targetStage.isLOB,
            },
          });

          // Create LOB Log if target stage is LOB
          if (targetStage.isLOB) {
            await tx.followUp.updateMany({
              where: {
                leadId,
                workspaceId,
                status: { in: ['PENDING', 'MISSED'] },
              },
              data: {
                status: 'CANCELLED',
                completionDescription: 'Superseded by LOB Workflow',
              },
            });

            if (!input.followUpRequired) {
              await tx.lead.update({
                where: { id: leadId },
                data: { nextFollowUpAt: null },
              });
            }

            if (effectiveReasonId) {
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
      } else if (selectedSubstage) {
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

    // Check & log specific property change events for complete audit history
    if (selectedSubstage && lead.substageId !== selectedSubstage.id) {
      await tx.leadActivity.create({
        data: {
          leadId,
          performedById: userId,
          workspaceId,
          action: 'SUBSTAGE_UPDATED',
          metadata: {
            previousSubstageName: lead.substage?.name || 'None',
            newSubstageName: selectedSubstage.name,
            previousSubstageId: lead.substageId || null,
            newSubstageId: selectedSubstage.id,
          },
        },
      });
    }

    if (input.connectionStatus) {
      const prevOutcome = await tx.leadCallOutcome.findFirst({
        where: { leadId, workspaceId, NOT: { id: outcome.id } },
        orderBy: { submittedAt: 'desc' },
      });
      if (!prevOutcome || prevOutcome.connectionStatus !== input.connectionStatus) {
        await tx.leadActivity.create({
          data: {
            leadId,
            performedById: userId,
            workspaceId,
            action: 'CONNECTION_STATUS_UPDATED',
            metadata: {
              previousStatus: prevOutcome?.connectionStatus || 'None',
              newStatus: input.connectionStatus,
            },
          },
        });
      }
      if (input.callPriority && (!prevOutcome || prevOutcome.callPriority !== input.callPriority)) {
        await tx.leadActivity.create({
          data: {
            leadId,
            performedById: userId,
            workspaceId,
            action: 'PRIORITY_UPDATED',
            metadata: {
              previousPriority: prevOutcome?.callPriority || 'None',
              newPriority: input.callPriority,
            },
          },
        });
      }
    }

    if (createdFollowUpId && input.nextFollowUpDate) {
      const prevDateIso = lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null;
      if (prevDateIso && prevDateIso.slice(0, 10) !== input.nextFollowUpDate) {
        await tx.leadActivity.create({
          data: {
            leadId,
            performedById: userId,
            workspaceId,
            action: 'FOLLOWUP_EXTENDED',
            metadata: {
              previousDate: prevDateIso,
              newDate: input.nextFollowUpDate,
              reason: input.outcomeNotes || input.followUpDescription || null,
              followUpId: createdFollowUpId,
            },
          },
        });
      }
    }

    // Fetch fresh authoritative lead state
    const updatedLead = await tx.lead.findUnique({
      where: { id: leadId },
      include: {
        stage: true,
        substage: true,
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
      lead: updatedLead,
      message: isApprovalTriggered
        ? 'Call outcome saved. Stage change submitted for supervisor approval.'
        : 'Call outcome saved successfully.',
    };
  });
};

export const ALLOWED_AUDIO_EXTENSIONS = new Set(['.m4a', '.aac', '.amr', '.3gp', '.wav', '.mp3']);

export const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/amr',
  'audio/amr-wb',
  'audio/3gpp',
  'video/3gpp',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mp3',
]);

export const validateAudioFile = (file: Express.Multer.File): { valid: boolean; error?: string; statusCode?: number } => {
  if (!file) {
    return { valid: false, error: 'Recording audio file is required.', statusCode: 400 };
  }

  if (!file.buffer || file.buffer.length === 0) {
    return { valid: false, error: 'Empty audio file provided.', statusCode: 400 };
  }

  const maxSizeBytes = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSizeBytes) {
    return { valid: false, error: 'File size exceeds maximum allowed limit of 50MB.', statusCode: 413 };
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext || !ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File extension '${ext}' is not supported for call recordings. Supported formats: .m4a, .aac, .amr, .3gp, .wav, .mp3`,
      statusCode: 415,
    };
  }

  const mime = (file.mimetype || '').toLowerCase().trim();
  if (mime && mime !== 'application/octet-stream' && !ALLOWED_AUDIO_MIMES.has(mime)) {
    return {
      valid: false,
      error: `MIME type '${mime}' is not supported for call recordings.`,
      statusCode: 415,
    };
  }

  if (file.buffer.length >= 4) {
    const headerHex = file.buffer.slice(0, 4).toString('hex').toLowerCase();
    if (headerHex.startsWith('4d5a') || headerHex.startsWith('7f454c46')) {
      return { valid: false, error: 'Executable files are strictly prohibited.', statusCode: 400 };
    }
  }

  return { valid: true };
};

export interface UploadCallRecordingInput {
  workspaceId: string;
  leadId: string;
  userId: string;
  callSessionId?: string | null;
  duration?: number | null;
  fileName?: string | null;
  mimeType?: string | null;
  file: Express.Multer.File;
}

export const uploadCallRecording = async (input: UploadCallRecordingInput) => {
  const { workspaceId, leadId, userId, file } = input;

  if (!workspaceId || !userId) {
    throw createError('Unauthorized', 401);
  }

  const validation = validateAudioFile(file);
  if (!validation.valid) {
    throw createError(validation.error || 'Invalid audio file', validation.statusCode || 400);
  }

  const lead = await (prisma as any).lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: { id: true, name: true, phone: true, assignedToId: true },
  });

  if (!lead) {
    throw createError('Lead not found or access denied', 404);
  }

  let callSession: any = null;
  if (input.callSessionId) {
    callSession = await (prisma as any).leadCallSession.findFirst({
      where: {
        id: input.callSessionId,
        workspaceId,
        leadId,
      },
    });

    if (!callSession) {
      throw createError('Call session not found for this lead and workspace', 404);
    }
  } else {
    callSession = await (prisma as any).leadCallSession.findFirst({
      where: {
        workspaceId,
        leadId,
        initiatedById: userId,
      },
      orderBy: { initiatedAt: 'desc' },
    });

    if (!callSession) {
      callSession = await (prisma as any).leadCallSession.findFirst({
        where: { workspaceId, leadId },
        orderBy: { initiatedAt: 'desc' },
      });
    }

    if (!callSession) {
      throw createError('No call session found for this lead', 404);
    }
  }

  // Idempotency: if recording already attached to this session, return existing canonical record
  if (callSession.recordingAvailable && callSession.recordingUrl) {
    logger.info('Call recording already uploaded for session', {
      callSessionId: callSession.id,
      recordingUrl: callSession.recordingUrl,
    });
    return {
      success: true,
      message: 'Call recording is already uploaded and available.',
      url: callSession.recordingUrl,
      key: callSession.recordingUrl,
      recordingId: callSession.id,
      data: {
        recordingId: callSession.id,
        leadId: callSession.leadId,
        callSessionId: callSession.id,
        recordingAvailable: true,
        recordingDuration: callSession.recordingDuration || input.duration || null,
        recordingStatus: callSession.recordingStatus || 'READY',
        url: callSession.recordingUrl,
      },
    };
  }

  // Persistent Wasabi storage upload
  const { storage } = await import('../../lib/storage/storage.factory');
  let uploadResult: { url: string; key: string };
  try {
    uploadResult = await storage.upload(file);
  } catch (storageErr: any) {
    logger.error('Persistent storage upload failed for call recording', {
      callSessionId: callSession.id,
      leadId,
      error: storageErr?.message || String(storageErr),
    });
    throw createError('Failed to upload recording to persistent storage.', 500);
  }

  const storedUrl = uploadResult.url;
  const storedKey = uploadResult.key;

  const validDuration =
    typeof input.duration === 'number' && !isNaN(input.duration) && input.duration > 0
      ? Math.round(input.duration)
      : null;

  // Update lead_call_sessions
  await (prisma as any).leadCallSession.update({
    where: { id: callSession.id },
    data: {
      recordingAvailable: true,
      recordingUrl: storedUrl,
      recordingDuration: validDuration ?? callSession.duration ?? null,
      recordingStatus: 'READY',
      recordingDownloadedAt: new Date(),
    },
  });

  // Idempotently log RECORDING_AVAILABLE activity
  const existingActivities = await (prisma as any).leadActivity.findMany({
    where: {
      leadId,
      workspaceId,
      action: 'RECORDING_AVAILABLE',
    },
    take: 10,
  });

  const alreadyHasActivity = existingActivities.some(
    (act: any) => act.metadata && act.metadata.callSessionId === callSession.id,
  );

  if (!alreadyHasActivity) {
    await (prisma as any).leadActivity.create({
      data: {
        leadId,
        performedById: userId,
        workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: {
          callSessionId: callSession.id,
          recordingUrl: storedUrl,
          storageKey: storedKey,
          duration: validDuration ?? callSession.duration ?? null,
          provider: callSession.provider || 'DEVICE_DIALER',
          recordingStatus: 'READY',
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
        },
      },
    });
  }

  return {
    success: true,
    message: 'Call recording uploaded successfully',
    url: storedUrl,
    key: storedKey,
    recordingId: callSession.id,
    data: {
      recordingId: callSession.id,
      leadId: callSession.leadId,
      callSessionId: callSession.id,
      recordingAvailable: true,
      recordingDuration: validDuration ?? callSession.duration ?? null,
      recordingStatus: 'READY',
      url: storedUrl,
    },
  };
};

