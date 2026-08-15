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
    where: { workspaceId, status: 'ACTIVE' },
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

  return { success: true, message: 'Call event processed idempotently.' };
};

export const getRecordingStreamOrUrl = async (
  workspaceId: string,
  userId: string,
  sessionId: string,
): Promise<{ url: string; recordingAvailable: boolean }> => {
  const session = await (prisma as any).leadCallSession.findFirst({
    where: { id: sessionId, workspaceId },
    select: { id: true, recordingAvailable: true, recordingUrl: true },
  });

  if (!session) {
    throw new Error('Call session not found or access denied.');
  }

  if (!session.recordingAvailable || !session.recordingUrl) {
    throw new Error('Call recording is not available for this call.');
  }

  return {
    url: session.recordingUrl,
    recordingAvailable: true,
  };
};
