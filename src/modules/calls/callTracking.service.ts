import path from 'path';
import crypto from 'crypto';
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

export const getCanonicalAudioMime = (ext: string, suppliedMime?: string | null): string => {
  const cleanExt = ext.toLowerCase();
  const map: Record<string, string> = {
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.amr': 'audio/amr',
    '.3gp': 'audio/3gpp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
  };

  const known = map[cleanExt];
  if (known) {
    if (!suppliedMime || suppliedMime === 'application/octet-stream') {
      return known;
    }
    const cleanMime = suppliedMime.toLowerCase().trim();
    if (ALLOWED_AUDIO_MIMES.has(cleanMime)) {
      return cleanMime;
    }
    return known;
  }
  return suppliedMime || 'application/octet-stream';
};

export const buildRecordingStorageKey = (
  workspaceId: string,
  leadId: string,
  callSessionId: string,
  extension: string,
): string => {
  const recordingsPrefix = (
    process.env.WASABI_RECORDINGS_PREFIX ||
    `${process.env.WASABI_ROOT_PREFIX || 'Seeak App Data/'}recordings/`
  ).replace(/^\/+/, '');

  // Sanitize extension: must be in allowed list, remove dangerous chars
  const sanitizedExt = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const cleanExt = sanitizedExt.startsWith('.') ? sanitizedExt : `.${sanitizedExt}`;

  // Sanitize parts to prevent any path traversal
  const cleanWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanLead = leadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanSession = callSessionId.replace(/[^a-zA-Z0-9_-]/g, '');

  return `${recordingsPrefix}${cleanWorkspace}/${cleanLead}/${cleanSession}/recording${cleanExt}`;
};

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

  const ext = path.extname(file.originalname || '').toLowerCase();
  const canonicalMime = getCanonicalAudioMime(ext, input.mimeType || file.mimetype);

  const lead = await (prisma as any).lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: { id: true, name: true, phone: true, assignedToId: true },
  });

  if (!lead) {
    throw createError('Lead not found or access denied', 404);
  }

  const callSessionId = typeof input.callSessionId === 'string' ? input.callSessionId.trim() : '';
  if (!callSessionId) {
    throw createError('callSessionId is required to associate recording.', 400);
  }

  const callSession = await (prisma as any).leadCallSession.findFirst({
    where: {
      id: callSessionId,
      workspaceId,
      leadId,
    },
  });

  if (!callSession) {
    throw createError('Call session not found for this lead and workspace', 404);
  }

  // Authorization check: User A cannot upload to User B's call session
  const isInitiator = callSession.initiatedById === userId;
  if (!isInitiator) {
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const roleName = (user?.role?.name || '').toLowerCase();
    const permissions = (user?.role?.permissions || []).map((rp: any) => rp.permission?.key);
    const isSuperAdmin =
      roleName === 'superadmin' ||
      roleName === 'admin' ||
      permissions.includes('*') ||
      permissions.includes('SUPERADMIN') ||
      permissions.includes('SYSTEM_CONFIG');

    const workspace = await (prisma as any).workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    const isOwner = workspace?.ownerId === userId;

    if (!isSuperAdmin && !isOwner) {
      throw createError(
        'Forbidden: You are not authorized to upload a recording for this call session.',
        403,
      );
    }
  }

  // Idempotency: calculate file SHA-256 hash
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  // If recording is already attached to this session and READY, return existing canonical record
  if (callSession.recordingAvailable && callSession.recordingUrl && callSession.recordingStatus === 'READY') {
    logger.info('Call recording already uploaded for session', {
      callSessionId: callSession.id,
      recordingUrl: callSession.recordingUrl,
    });
    const recordingDuration = callSession.recordingDuration || input.duration || null;
    return {
      success: true,
      callSessionId: callSession.id,
      leadId: callSession.leadId,
      recordingAvailable: true,
      recordingStatus: 'READY',
      recordingDuration,
      message: 'Call recording is already uploaded and available.',
      url: callSession.recordingUrl,
      key: callSession.recordingUrl,
      recordingId: callSession.id,
      data: {
        recordingId: callSession.id,
        leadId: callSession.leadId,
        callSessionId: callSession.id,
        recordingAvailable: true,
        recordingDuration,
        recordingStatus: 'READY',
        url: callSession.recordingUrl,
      },
    };
  }

  // Build deterministic collision-safe object key:
  // <prefix>/<workspace>/<lead>/<callSession>/recording.<extension>
  const storageKey = buildRecordingStorageKey(workspaceId, leadId, callSession.id, ext);

  // Persistent Wasabi storage upload with private permissions
  const { storage } = await import('../../lib/storage/storage.factory');
  try {
    if (typeof (storage as any).uploadRecording === 'function') {
      await (storage as any).uploadRecording(file.buffer, storageKey, canonicalMime);
    } else {
      await storage.upload(file);
    }
  } catch (storageErr: any) {
    logger.error('Persistent storage upload failed for call recording', {
      callSessionId: callSession.id,
      leadId,
      error: storageErr?.message || String(storageErr),
    });
    throw createError('Failed to upload recording to persistent storage.', 500);
  }

  const validDuration =
    typeof input.duration === 'number' && !isNaN(input.duration) && input.duration > 0
      ? Math.round(input.duration)
      : null;

  // Transactionally update database: lead_call_sessions and leadActivity
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.leadCallSession.update({
      where: { id: callSession.id },
      data: {
        recordingAvailable: true,
        recordingUrl: storageKey,
        recordingDuration: validDuration ?? callSession.duration ?? null,
        recordingStatus: 'READY',
        recordingDownloadedAt: new Date(),
      },
    });

    const existingActivities = await tx.leadActivity.findMany({
      where: {
        leadId,
        workspaceId,
        action: 'RECORDING_AVAILABLE',
      },
      take: 20,
    });

    const matchingActivity = existingActivities.find(
      (act: any) => act.metadata && act.metadata.callSessionId === callSession.id,
    );

    const activityMetadata = {
      callSessionId: callSession.id,
      storageKey,
      fileHash,
      fileName: input.fileName || file.originalname,
      displayName: input.fileName || file.originalname,
      mimeType: canonicalMime,
      fileSize: file.size,
      duration: validDuration ?? callSession.duration ?? null,
      recordingDuration: validDuration ?? callSession.duration ?? null,
      provider: callSession.provider || 'DEVICE_DIALER',
      recordingAvailable: true,
      recordingStatus: 'READY',
    };

    if (matchingActivity) {
      await tx.leadActivity.update({
        where: { id: matchingActivity.id },
        data: {
          performedById: userId,
          metadata: activityMetadata,
        },
      });
    } else {
      await tx.leadActivity.create({
        data: {
          leadId,
          performedById: userId,
          workspaceId,
          action: 'RECORDING_AVAILABLE',
          metadata: activityMetadata,
        },
      });
    }
  });

  const recordingDuration = validDuration ?? callSession.duration ?? null;
  return {
    success: true,
    callSessionId: callSession.id,
    leadId: callSession.leadId,
    recordingAvailable: true,
    recordingStatus: 'READY',
    recordingDuration,
    message: 'Call recording uploaded successfully',
    url: storageKey,
    key: storageKey,
    recordingId: callSession.id,
    data: {
      recordingId: callSession.id,
      leadId: callSession.leadId,
      callSessionId: callSession.id,
      recordingAvailable: true,
      recordingDuration,
      recordingStatus: 'READY',
      url: storageKey,
    },
  };
};

