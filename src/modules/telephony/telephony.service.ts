import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { encryptToken, decryptToken } from '../../utils/encryption';
import { getTelephonyAdapter, getAllAvailableProviders } from './telephony.factory';
import { TelephonyProviderConfigData, TelephonySettingsData } from './telephony.types';

export const getTelephonySettings = async (workspaceId: string): Promise<TelephonySettingsData> => {
  let settings = await (prisma as any).telephonySetting.findFirst({
    where: { workspaceId },
  });

  if (!settings) {
    settings = await (prisma as any).telephonySetting.create({
      data: {
        workspaceId,
        activeProvider: 'DEVICE_DIALER',
        recordingEnabled: false,
        recordOutbound: true,
        recordInbound: true,
        recordingStorage: 'PROVIDER_STORAGE',
        retentionMonths: 12,
      },
    });
  }

  return {
    activeProvider: settings.activeProvider as any,
    recordingEnabled: settings.recordingEnabled,
    recordOutbound: settings.recordOutbound,
    recordInbound: settings.recordInbound,
    recordingStorage: settings.recordingStorage as any,
    retentionMonths: settings.retentionMonths,
  };
};

export const updateTelephonySettings = async (
  workspaceId: string,
  input: Partial<TelephonySettingsData>,
): Promise<TelephonySettingsData> => {
  const existing = await getTelephonySettings(workspaceId);

  const updated = await (prisma as any).telephonySetting.update({
    where: { workspaceId },
    data: {
      activeProvider: input.activeProvider ?? existing.activeProvider,
      recordingEnabled: input.recordingEnabled !== undefined ? input.recordingEnabled : existing.recordingEnabled,
      recordOutbound: input.recordOutbound !== undefined ? input.recordOutbound : existing.recordOutbound,
      recordInbound: input.recordInbound !== undefined ? input.recordInbound : existing.recordInbound,
      recordingStorage: input.recordingStorage ?? existing.recordingStorage,
      retentionMonths: input.retentionMonths ?? existing.retentionMonths,
    },
  });

  return {
    activeProvider: updated.activeProvider as any,
    recordingEnabled: updated.recordingEnabled,
    recordOutbound: updated.recordOutbound,
    recordInbound: updated.recordInbound,
    recordingStorage: updated.recordingStorage as any,
    retentionMonths: updated.retentionMonths,
  };
};

export const getProviderConfigs = async (workspaceId: string): Promise<any[]> => {
  const available = getAllAvailableProviders();
  const dbConfigs = await (prisma as any).telephonyProviderConfig.findMany({
    where: { workspaceId },
  });

  const configMap = new Map(dbConfigs.map((c: any) => [c.providerKey, c]));

  return available.map((provider) => {
    const dbConfig: any = configMap.get(provider.key);
    return {
      providerKey: provider.key,
      providerName: provider.name,
      capabilities: provider.capabilities,
      enabled: dbConfig ? dbConfig.enabled : provider.key === 'DEVICE_DIALER',
      virtualNumber: dbConfig?.virtualNumber || '',
      callerId: dbConfig?.callerId || '',
      hasApiKey: Boolean(dbConfig?.apiKeyEncrypted),
      hasApiSecret: Boolean(dbConfig?.apiSecretEncrypted),
      hasAccountId: Boolean(dbConfig?.accountIdEncrypted),
      hasAuthToken: Boolean(dbConfig?.authTokenEncrypted),
      hasWebhookSecret: Boolean(dbConfig?.webhookSecretEncrypted),
      lastHealthCheckAt: dbConfig?.lastHealthCheckAt || null,
      lastError: dbConfig?.lastError || null,
    };
  });
};

export const saveProviderConfig = async (
  workspaceId: string,
  providerKey: string,
  input: {
    enabled?: boolean;
    apiKey?: string;
    apiSecret?: string;
    accountId?: string;
    authToken?: string;
    virtualNumber?: string;
    callerId?: string;
    webhookSecret?: string;
    customSettingsJson?: string;
  },
): Promise<any> => {
  const existing = await (prisma as any).telephonyProviderConfig.findFirst({
    where: { workspaceId, providerKey },
  });

  const apiKeyEncrypted = input.apiKey ? encryptToken(input.apiKey) : existing?.apiKeyEncrypted;
  const apiSecretEncrypted = input.apiSecret ? encryptToken(input.apiSecret) : existing?.apiSecretEncrypted;
  const accountIdEncrypted = input.accountId ? encryptToken(input.accountId) : existing?.accountIdEncrypted;
  const authTokenEncrypted = input.authToken ? encryptToken(input.authToken) : existing?.authTokenEncrypted;
  const webhookSecretEncrypted = input.webhookSecret ? encryptToken(input.webhookSecret) : existing?.webhookSecretEncrypted;

  const data = {
    enabled: input.enabled !== undefined ? input.enabled : existing?.enabled ?? true,
    providerName: providerKey,
    apiKeyEncrypted,
    apiSecretEncrypted,
    accountIdEncrypted,
    authTokenEncrypted,
    virtualNumber: input.virtualNumber !== undefined ? input.virtualNumber : existing?.virtualNumber,
    callerId: input.callerId !== undefined ? input.callerId : existing?.callerId,
    webhookSecretEncrypted,
    customSettingsJson: input.customSettingsJson !== undefined ? input.customSettingsJson : existing?.customSettingsJson,
  };

  if (existing) {
    return (prisma as any).telephonyProviderConfig.update({
      where: { id: existing.id },
      data,
    });
  } else {
    return (prisma as any).telephonyProviderConfig.create({
      data: {
        workspaceId,
        providerKey,
        ...data,
      },
    });
  }
};

export const getDecryptedProviderConfig = async (
  workspaceId: string,
  providerKey: string,
): Promise<TelephonyProviderConfigData> => {
  const dbConfig = await (prisma as any).telephonyProviderConfig.findFirst({
    where: { workspaceId, providerKey },
  });

  return {
    providerKey: providerKey as any,
    providerName: providerKey,
    enabled: dbConfig ? dbConfig.enabled : true,
    apiKey: dbConfig?.apiKeyEncrypted ? decryptToken(dbConfig.apiKeyEncrypted) : undefined,
    apiSecret: dbConfig?.apiSecretEncrypted ? decryptToken(dbConfig.apiSecretEncrypted) : undefined,
    accountId: dbConfig?.accountIdEncrypted ? decryptToken(dbConfig.accountIdEncrypted) : undefined,
    authToken: dbConfig?.authTokenEncrypted ? decryptToken(dbConfig.authTokenEncrypted) : undefined,
    virtualNumber: dbConfig?.virtualNumber || undefined,
    callerId: dbConfig?.callerId || undefined,
    webhookSecret: dbConfig?.webhookSecretEncrypted ? decryptToken(dbConfig.webhookSecretEncrypted) : undefined,
    customSettingsJson: dbConfig?.customSettingsJson || undefined,
  };
};

export const testProviderConnection = async (
  workspaceId: string,
  providerKey: string,
): Promise<{ success: boolean; message: string }> => {
  const config = await getDecryptedProviderConfig(workspaceId, providerKey);
  const adapter = getTelephonyAdapter(providerKey);
  return adapter.testConnection(config);
};

export const initiateProviderCall = async (
  workspaceId: string,
  leadId: string,
  userId: string,
  cleanPhone: string,
  sourceContext = 'LEAD_DETAILS',
): Promise<{ activeProvider: string; callResult: any }> => {
  const settings = await getTelephonySettings(workspaceId);
  const activeProviderKey = settings.activeProvider;

  const config = await getDecryptedProviderConfig(workspaceId, activeProviderKey);
  const adapter = getTelephonyAdapter(activeProviderKey);

  // Resolve specific user mapping for agent number / extension if configured
  const userMapping = await (prisma as any).telephonyUserMapping.findFirst({
    where: { workspaceId, userId, providerKey: activeProviderKey, enabled: true },
  });

  let fromNumber = config.callerId || config.virtualNumber || undefined;
  if (userMapping?.providerPhoneNumber || userMapping?.providerAgentId) {
    fromNumber = userMapping.providerPhoneNumber || userMapping.providerAgentId || fromNumber;
  }

  const callResult = await adapter.initiateCall(
    {
      workspaceId,
      leadId,
      userId,
      fromNumber,
      toNumber: cleanPhone,
      cleanPhone,
      sourceContext,
      recordingEnabled: settings.recordingEnabled,
    },
    config,
  );

  return {
    activeProvider: activeProviderKey,
    callResult,
  };
};

export const getTelephonyUserMappings = async (
  workspaceId: string,
  providerKey: string,
): Promise<any[]> => {
  const users = await (prisma as any).user.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  });

  const mappings = await (prisma as any).telephonyUserMapping.findMany({
    where: { workspaceId, providerKey },
  });

  const mappingMap = new Map(mappings.map((m: any) => [m.userId, m]));

  return users.map((u: any) => {
    const existing: any = mappingMap.get(u.id);
    return {
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      userPhone: u.phone || '',
      providerKey,
      providerAgentId: existing?.providerAgentId || '',
      providerPhoneNumber: existing?.providerPhoneNumber || u.phone || '',
      enabled: existing ? existing.enabled : true,
    };
  });
};

export const getProviderAgents = async (
  workspaceId: string,
  providerKey: string,
): Promise<any[]> => {
  const config = await getDecryptedProviderConfig(workspaceId, providerKey);
  const adapter = getTelephonyAdapter(providerKey);
  return adapter.getAgents(config);
};

export const saveTelephonyUserMapping = async (
  workspaceId: string,
  providerKey: string,
  userId: string,
  data: { providerAgentId?: string; providerPhoneNumber?: string; enabled?: boolean },
): Promise<any> => {
  const existing = await (prisma as any).telephonyUserMapping.findFirst({
    where: { workspaceId, userId, providerKey },
  });

  if (existing) {
    return (prisma as any).telephonyUserMapping.update({
      where: { id: existing.id },
      data: {
        providerAgentId: data.providerAgentId !== undefined ? data.providerAgentId : existing.providerAgentId,
        providerPhoneNumber: data.providerPhoneNumber !== undefined ? data.providerPhoneNumber : existing.providerPhoneNumber,
        enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
      },
    });
  } else {
    return (prisma as any).telephonyUserMapping.create({
      data: {
        workspaceId,
        userId,
        providerKey,
        providerAgentId: data.providerAgentId || null,
        providerPhoneNumber: data.providerPhoneNumber || null,
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });
  }
};

export const processWebhook = async (
  providerKey: string,
  rawBody: any,
  headers: any,
  query: any,
): Promise<{ success: boolean; message: string }> => {
  const adapter = getTelephonyAdapter(providerKey);
  // Find matching workspace by providerCallId or query
  const payload = rawBody || {};
  const providerCallId = payload.call_id || payload.uuid || payload.CallUUID || payload.CallSid || query?.call_id || query?.CallSid;

  if (!providerCallId) {
    return { success: false, message: 'No provider call ID found in webhook.' };
  }

  const callSession = await (prisma as any).leadCallSession.findFirst({
    where: {
      OR: [
        { providerCallId: String(providerCallId) },
        { id: String(providerCallId) },
      ],
    },
  });

  if (!callSession) {
    logger.info('[TelephonyWebhook] Call session not found for providerCallId', { providerKey, providerCallId });
    return { success: true, message: 'Event ignored: call session not found.' };
  }

  const config = await getDecryptedProviderConfig(callSession.workspaceId, providerKey);
  const isValid = adapter.validateWebhook(payload, headers, query, config);
  if (!isValid) {
    throw new Error('Webhook signature validation failed.');
  }

  const event = await adapter.handleWebhook(payload, headers, query, config);
  if (!event) {
    return { success: true, message: 'Event received.' };
  }

  // Idempotently update call session with status & recording info
  const updateData: any = {
    provider: providerKey,
    updatedAt: new Date(),
  };

  if (event.status) updateData.status = event.status;
  if (event.duration !== undefined) updateData.duration = event.duration;
  if (event.endedAt) updateData.endedAt = event.endedAt;

  if (event.recordingAvailable && event.recordingUrl) {
    updateData.recordingAvailable = true;
    updateData.recordingUrl = event.recordingUrl;
    updateData.recordingDuration = event.recordingDuration || event.duration || 0;
    updateData.recordingStatus = 'READY';
  }

  await (prisma as any).leadCallSession.update({
    where: { id: callSession.id },
    data: updateData,
  });

  if (event.recordingAvailable) {
    await (prisma as any).leadActivity.create({
      data: {
        leadId: callSession.leadId,
        performedById: callSession.initiatedById,
        workspaceId: callSession.workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: {
          callSessionId: callSession.id,
          provider: providerKey,
          recordingUrl: event.recordingUrl,
          duration: event.recordingDuration || event.duration || 0,
        },
      },
    });
  }

  if (callSession.direction === 'INBOUND') {
    const isCompleted = event.event === 'COMPLETED' || event.event === 'ANSWERED';
    const isFailed = event.event === 'FAILED';
    
    if (isCompleted || isFailed) {
      try {
        const { eventDispatcher } = await import('../automation/eventDispatcher');
        const trigger = isCompleted ? 'telephony.incoming_received' : 'telephony.incoming_missed';
        
        const lead = await prisma.lead.findFirst({
          where: { id: callSession.leadId, workspaceId: callSession.workspaceId, deletedAt: null },
        });
        
        if (lead) {
          void eventDispatcher.dispatch(trigger, {
            workspaceId: callSession.workspaceId,
            recordId: lead.id,
            recordType: 'Lead',
            newData: lead,
          });
        }
      } catch (e: any) {
        logger.error('Failed to dispatch telephony automation trigger', { error: e.message });
      }
    }
  }

  return { success: true, message: 'Call event processed idempotently.' };
};

export const verifyRecordingAccess = async (
  workspaceId: string,
  userId: string,
  sessionId: string,
) => {
  const session = await (prisma as any).leadCallSession.findFirst({
    where: { id: sessionId, workspaceId },
    include: {
      lead: {
        select: { id: true, name: true, assignedToId: true, workspaceId: true },
      },
    },
  });

  if (!session) {
    const error: any = new Error('Call session not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  // Verify User Authorization ("User A cannot play User B's recording")
  const isInitiator = session.initiatedById === userId;
  const isLeadAssignee = session.lead?.assignedToId === userId || session.assignedUserId === userId;

  if (!isInitiator && !isLeadAssignee) {
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
    const permissions: string[] = (user?.role?.permissions || []).map((rp: any) => rp.permission?.key);
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

    const hasViewAll =
      permissions.includes('LEADS_VIEW_ALL') ||
      permissions.includes('CALL_OUTCOMES_VIEW');

    let isTeamAllowed = false;
    if (permissions.includes('LEADS_VIEW_TEAM')) {
      try {
        const leadsRepository = await import('../leads/leads.repository');
        const teamUserIds = await leadsRepository.getRecursiveTeamUserIds(workspaceId, userId);
        const teamSet = new Set(teamUserIds);
        if (
          (session.initiatedById && teamSet.has(session.initiatedById)) ||
          (session.lead?.assignedToId && teamSet.has(session.lead.assignedToId))
        ) {
          isTeamAllowed = true;
        }
      } catch {
        // Fallback if repository fails
      }
    }

    if (!isSuperAdmin && !isOwner && !hasViewAll && !isTeamAllowed) {
      const error: any = new Error('Forbidden: You are not authorized to access this call recording.');
      error.statusCode = 403;
      throw error;
    }
  }

  return session;
};

export const extractStorageKeyFromRecordingUrl = (url: string): string => {
  if (!url) return '';
  let clean = url.trim();
  if (clean.startsWith('/api/upload/')) {
    clean = decodeURIComponent(clean.replace('/api/upload/', ''));
  }
  return clean.replace(/^\/+/, '');
};

export const getRecordingStreamOrUrl = async (
  workspaceId: string,
  userId: string,
  sessionId: string,
): Promise<{
  url: string;
  streamUrl?: string;
  recordingAvailable: boolean;
  recordingStatus?: string;
  duration?: number | null;
  displayName?: string;
}> => {
  const session = await verifyRecordingAccess(workspaceId, userId, sessionId);

  if (!session.recordingAvailable || !session.recordingUrl) {
    const error: any = new Error('Call recording is not available for this call.');
    error.statusCode = 404;
    throw error;
  }

  let finalUrl = session.recordingUrl;
  const storageKey = extractStorageKeyFromRecordingUrl(session.recordingUrl);

  try {
    const { storage } = await import('../../lib/storage/storage.factory');
    if (storage.getPresignedUrl && storageKey) {
      const presigned = await storage.getPresignedUrl(storageKey);
      if (presigned) {
        finalUrl = presigned;
      }
    }
  } catch (err: any) {
    logger.warn('Failed to generate presigned URL for recording, falling back to recordingUrl', {
      sessionId,
      error: err?.message,
    });
  }

  return {
    url: finalUrl,
    streamUrl: `/api/telephony/recordings/${sessionId}/stream`,
    recordingAvailable: true,
    recordingStatus: session.recordingStatus || 'READY',
    duration: session.recordingDuration || session.duration || null,
    displayName: session.lead?.name ? `Recording - ${session.lead.name}` : 'Call Recording',
  };
};

export const streamRecording = async (
  workspaceId: string,
  userId: string,
  sessionId: string,
  range?: string,
) => {
  const session = await verifyRecordingAccess(workspaceId, userId, sessionId);

  if (!session.recordingAvailable || !session.recordingUrl) {
    const error: any = new Error('Call recording is not available for this call.');
    error.statusCode = 404;
    throw error;
  }

  const storageKey = extractStorageKeyFromRecordingUrl(session.recordingUrl);
  const { storage } = await import('../../lib/storage/storage.factory');

  if (!storage.getFileStream) {
    const error: any = new Error('Storage streaming is not supported by driver.');
    error.statusCode = 500;
    throw error;
  }

  return await storage.getFileStream(storageKey, range);
};

export const getRecordingDiagnostic = async (
  workspaceId: string,
  userId: string,
  sessionId: string,
) => {
  const session = await verifyRecordingAccess(workspaceId, userId, sessionId);

  const storageKey = extractStorageKeyFromRecordingUrl(session.recordingUrl || '');
  let wasabiObjectExists = false;
  let wasabiObjectSize: number | undefined;
  let wasabiContentType: string | undefined;

  if (storageKey) {
    try {
      const { storage } = await import('../../lib/storage/storage.factory');
      if (typeof (storage as any).getObjectMetadata === 'function') {
        const meta = await (storage as any).getObjectMetadata(storageKey);
        wasabiObjectExists = Boolean(meta.exists);
        wasabiObjectSize = meta.size;
        wasabiContentType = meta.contentType;
      }
    } catch {
      wasabiObjectExists = false;
    }
  }

  return {
    callSessionId: session.id,
    leadId: session.leadId,
    workspaceId: session.workspaceId,
    initiatedById: session.initiatedById,
    assignedUserId: session.assignedUserId,
    recordingAvailable: session.recordingAvailable,
    recordingStatus: session.recordingStatus || 'UNKNOWN',
    recordingDuration: session.recordingDuration,
    storageKey,
    wasabiObjectExists,
    wasabiObjectSize,
    wasabiContentType,
    playbackReady: Boolean(session.recordingAvailable && wasabiObjectExists),
  };
};

