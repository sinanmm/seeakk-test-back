import crypto from 'crypto';
import prisma from '../../../config/prisma';
import logger from '../../../utils/logger';
import { encryptToken, decryptToken } from '../../../utils/encryption';
import { createLead } from '../../../services/User/leadService';

const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v20.0';
const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'seeakk-meta-verify-token';

const getRedirectUri = (): string => {
  if (process.env.META_OAUTH_REDIRECT_URI) return process.env.META_OAUTH_REDIRECT_URI;
  const baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';
  return `${baseUrl}/api/integrations/meta/callback`;
};

export const getMetaAuthUrl = (workspaceId: string, userId: string): string => {
  if (!META_APP_ID) {
    throw new Error('META_APP_ID is not configured in backend environment variables.');
  }

  const redirectUri = getRedirectUri();
  const stateData = JSON.stringify({ workspaceId, userId, timestamp: Date.now() });
  const hmac = crypto.createHmac('sha256', META_APP_SECRET || 'seeakk-meta-secret').update(stateData).digest('hex');
  const state = Buffer.from(JSON.stringify({ data: stateData, hmac })).toString('base64url');

  const scope = 'pages_show_list,pages_read_engagement,leads_retrieval,pages_manage_metadata';

  return `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?client_id=${encodeURIComponent(
    META_APP_ID,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}`;
};

export const handleMetaOAuthCallback = async (
  workspaceId: string,
  userId: string,
  code: string,
): Promise<{ success: boolean; message: string }> => {
  const redirectUri = getRedirectUri();

  // 1. Exchange authorization code for short-lived access token
  const tokenUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token?client_id=${encodeURIComponent(
    META_APP_ID,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(
    META_APP_SECRET,
  )}&code=${encodeURIComponent(code)}`;

  const tokenRes = await fetch(tokenUrl);
  const tokenData = (await tokenRes.json()) as any;

  if (!tokenRes.ok || tokenData.error) {
    const errorMsg = tokenData.error?.message || 'Failed to exchange Meta authorization code.';
    logger.error('[MetaIntegration] OAuth token exchange failed', { errorMsg });
    throw new Error(errorMsg);
  }

  const shortLivedToken = tokenData.access_token;

  // 2. Exchange for long-lived user access token
  const longLivedUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(
    META_APP_ID,
  )}&client_secret=${encodeURIComponent(META_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

  const longRes = await fetch(longLivedUrl);
  const longData = (await longRes.json()) as any;
  const userAccessToken = longRes.ok && longData.access_token ? longData.access_token : shortLivedToken;
  const expiresIn = longData.expires_in ? Number(longData.expires_in) : 60 * 24 * 60 * 60;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // 3. Fetch Meta User Profile
  const meRes = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`);
  const meData = (await meRes.json()) as any;
  const metaUserId = meData.id || 'unknown';
  const metaUserName = meData.name || 'Meta Business Account';

  // 4. Save/Update MetaConnection
  const encryptedUserToken = encryptToken(userAccessToken);

  const existingConn = await (prisma as any).metaConnection.findFirst({
    where: { workspaceId },
  });

  let metaConnectionId = existingConn?.id;

  if (existingConn) {
    await (prisma as any).metaConnection.update({
      where: { id: existingConn.id },
      data: {
        metaUserId,
        metaUserName,
        status: 'CONNECTED',
        accessTokenEncrypted: encryptedUserToken,
        tokenExpiresAt,
        connectedByUserId: userId,
        lastHealthCheckAt: new Date(),
        lastError: null,
      },
    });
  } else {
    const newConn = await (prisma as any).metaConnection.create({
      data: {
        workspaceId,
        metaUserId,
        metaUserName,
        status: 'CONNECTED',
        accessTokenEncrypted: encryptedUserToken,
        tokenExpiresAt,
        connectedByUserId: userId,
        lastHealthCheckAt: new Date(),
      },
    });
    metaConnectionId = newConn.id;
  }

  // 5. Fetch User Pages & Page Access Tokens
  const pagesRes = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(
      userAccessToken,
    )}`,
  );
  const pagesData = (await pagesRes.json()) as any;

  if (pagesData.data && Array.isArray(pagesData.data)) {
    for (const page of pagesData.data) {
      const encryptedPageToken = encryptToken(page.access_token);
      const existingPage = await (prisma as any).metaPageConnection.findFirst({
        where: { workspaceId, metaPageId: page.id },
      });

      if (existingPage) {
        await (prisma as any).metaPageConnection.update({
          where: { id: existingPage.id },
          data: {
            pageName: page.name,
            pageAccessTokenEncrypted: encryptedPageToken,
            status: 'ACTIVE',
          },
        });
      } else {
        await (prisma as any).metaPageConnection.create({
          data: {
            workspaceId,
            metaConnectionId,
            metaPageId: page.id,
            pageName: page.name,
            pageAccessTokenEncrypted: encryptedPageToken,
            status: 'ACTIVE',
          },
        });
      }
    }
  }

  return { success: true, message: 'Meta account connected successfully.' };
};

export const getMetaStatus = async (workspaceId: string): Promise<any> => {
  const connection = await (prisma as any).metaConnection.findFirst({
    where: { workspaceId },
    select: {
      id: true,
      status: true,
      metaUserId: true,
      metaUserName: true,
      tokenExpiresAt: true,
      lastHealthCheckAt: true,
      lastError: true,
      updatedAt: true,
    },
  });

  if (!connection) {
    return {
      status: 'NOT_CONNECTED',
      accountName: null,
      connectedPagesCount: 0,
      activeFormsCount: 0,
      importedToday: 0,
      importedMonth: 0,
      failedImports: 0,
      lastSync: null,
    };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [connectedPagesCount, activeFormsCount, importedToday, importedMonth, failedImports, lastImport] = await Promise.all([
    (prisma as any).metaPageConnection.count({ where: { workspaceId, status: 'ACTIVE' } }),
    (prisma as any).metaLeadForm.count({ where: { workspaceId, enabled: true } }),
    (prisma as any).metaLeadImport.count({ where: { workspaceId, status: 'IMPORTED', createdAt: { gte: startOfDay } } }),
    (prisma as any).metaLeadImport.count({ where: { workspaceId, status: 'IMPORTED', createdAt: { gte: startOfMonth } } }),
    (prisma as any).metaLeadImport.count({ where: { workspaceId, status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT'] } } }),
    (prisma as any).metaLeadImport.findFirst({
      where: { workspaceId, status: 'IMPORTED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    status: connection.status,
    accountName: connection.metaUserName || 'Meta Business Account',
    connectedPagesCount,
    activeFormsCount,
    importedToday,
    importedMonth,
    failedImports,
    lastSync: lastImport?.createdAt ? lastImport.createdAt.toISOString() : connection.updatedAt.toISOString(),
  };
};

export const getPagesAndForms = async (workspaceId: string): Promise<any[]> => {
  const pages = await (prisma as any).metaPageConnection.findMany({
    where: { workspaceId },
    include: {
      forms: {
        include: {
          fieldMappings: true,
          defaultLeadStage: { select: { id: true, name: true } },
          leadSource: { select: { id: true, name: true } },
          assignmentUser: { select: { id: true, name: true, username: true, email: true } },
        },
      },
    },
  });

  return pages.map((page: any) => ({
    id: page.id,
    metaPageId: page.metaPageId,
    pageName: page.pageName,
    status: page.status,
    forms: page.forms.map((form: any) => ({
      id: form.id,
      metaFormId: form.metaFormId,
      formName: form.formName,
      enabled: form.enabled,
      defaultLeadStage: form.defaultLeadStage,
      leadSource: form.leadSource,
      assignmentType: form.assignmentType,
      assignmentUser: form.assignmentUser,
      roundRobinUserIds: form.roundRobinUserIds ? JSON.parse(form.roundRobinUserIds) : [],
      fieldMappings: form.fieldMappings,
    })),
  }));
};

export const saveFormConfig = async (
  workspaceId: string,
  formId: string,
  input: {
    enabled: boolean;
    defaultLeadStageId?: string | null;
    leadSourceId?: string | null;
    assignmentType: 'UNASSIGNED' | 'SPECIFIC_USER' | 'ROUND_ROBIN';
    assignmentUserId?: string | null;
    roundRobinUserIds?: string[];
    fieldMappings: Array<{
      metaFieldName: string;
      metaFieldLabel?: string;
      seeakkFieldKey: string;
    }>;
  },
): Promise<any> => {
  const form = await (prisma as any).metaLeadForm.findFirst({
    where: { id: formId, workspaceId },
  });

  if (!form) {
    throw new Error('Meta Lead Form configuration not found in this workspace.');
  }

  // Ensure default Lead Source exists if not specified
  let leadSourceId = input.leadSourceId;
  if (!leadSourceId) {
    const defaultSource = await (prisma as any).leadSource.findFirst({
      where: { workspaceId, name: { contains: 'Meta', mode: 'insensitive' } },
      select: { id: true },
    });
    if (defaultSource) {
      leadSourceId = defaultSource.id;
    } else {
      const createdSource = await (prisma as any).leadSource.create({
        data: {
          workspaceId,
          name: 'Meta Ads',
          status: 'ACTIVE',
        },
      });
      leadSourceId = createdSource.id;
    }
  }

  const updatedForm = await (prisma as any).metaLeadForm.update({
    where: { id: formId },
    data: {
      enabled: input.enabled,
      defaultLeadStageId: input.defaultLeadStageId || null,
      leadSourceId,
      assignmentType: input.assignmentType,
      assignmentUserId: input.assignmentType === 'SPECIFIC_USER' ? input.assignmentUserId || null : null,
      roundRobinUserIds: input.assignmentType === 'ROUND_ROBIN' && input.roundRobinUserIds ? JSON.stringify(input.roundRobinUserIds) : null,
    },
  });

  // Re-create field mappings
  await (prisma as any).metaFieldMapping.deleteMany({
    where: { metaLeadFormId: formId },
  });

  if (input.fieldMappings && input.fieldMappings.length > 0) {
    await (prisma as any).metaFieldMapping.createMany({
      data: input.fieldMappings.map((m) => ({
        metaLeadFormId: formId,
        metaFieldName: m.metaFieldName,
        metaFieldLabel: m.metaFieldLabel || m.metaFieldName,
        seeakkFieldKey: m.seeakkFieldKey,
      })),
    });
  }

  return updatedForm;
};

export const handleWebhookVerification = (mode: string, verifyToken: string, challenge: string): string => {
  if (mode === 'subscribe' && verifyToken === META_WEBHOOK_VERIFY_TOKEN) {
    return challenge;
  }
  throw new Error('Webhook verification failed: token mismatch.');
};

let roundRobinCounter = 0;

export const processLeadGenWebhook = async (payload: any): Promise<void> => {
  if (payload.object !== 'page' || !Array.isArray(payload.entry)) return;

  for (const entry of payload.entry) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'leadgen') continue;
      const value = change.value;
      if (!value || !value.leadgen_id) continue;

      const metaLeadId = String(value.leadgen_id);
      const metaFormId = String(value.form_id || '');
      const metaPageId = String(value.page_id || '');

      // Locate corresponding MetaLeadForm across workspaces
      const forms = await (prisma as any).metaLeadForm.findMany({
        where: { metaFormId, enabled: true },
        include: {
          metaPageConnection: true,
          fieldMappings: true,
        },
      });

      if (forms.length === 0) {
        logger.info('[MetaWebhook] Form not configured or enabled', { metaFormId, metaLeadId });
        continue;
      }

      for (const formConfig of forms) {
        const workspaceId = formConfig.workspaceId;

        // Idempotency check: Database Unique Constraint on (workspaceId, metaLeadId)
        let importRecord: any;
        try {
          importRecord = await (prisma as any).metaLeadImport.create({
            data: {
              workspaceId,
              metaLeadId,
              metaPageId,
              metaFormId,
              status: 'PROCESSING',
              rawPayloadJson: JSON.stringify(value),
            },
          });
        } catch (err: any) {
          // P2002 Unique constraint failed: Already received and processed this Meta lead!
          logger.info('[MetaWebhook] Duplicate Meta Lead ID ignored', { workspaceId, metaLeadId });
          continue;
        }

        try {
          // Fetch full lead payload from Meta Graph API
          const pageAccessTokenEncrypted = formConfig.metaPageConnection?.pageAccessTokenEncrypted;
          const pageAccessToken = pageAccessTokenEncrypted ? decryptToken(pageAccessTokenEncrypted) : null;

          if (!pageAccessToken) {
            throw new Error('Page access token unavailable or decryption failed.');
          }

          const leadRes = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${metaLeadId}?access_token=${encodeURIComponent(pageAccessToken)}`);
          const leadData = (await leadRes.json()) as any;

          if (!leadRes.ok || leadData.error) {
            throw new Error(leadData.error?.message || 'Failed to retrieve lead data from Meta Graph API.');
          }

          const fieldData: Array<{ name: string; values: string[] }> = leadData.field_data || [];
          const fieldMap = new Map<string, string>();
          for (const fd of fieldData) {
            if (fd.name && Array.isArray(fd.values) && fd.values.length > 0) {
              fieldMap.set(fd.name.toLowerCase(), fd.values[0]);
            }
          }

          // Map Meta fields to Seeakk CreateLeadInput
          const leadInput: any = {
            name: 'Meta Lead',
            remarks: `Imported via Meta Lead Ads (Form: ${formConfig.formName})`,
          };

          const mappings = formConfig.fieldMappings || [];
          const dynamicValues: Array<{ fieldId: string; value: string }> = [];

          for (const m of mappings) {
            const val = fieldMap.get(m.metaFieldName.toLowerCase());
            if (!val) continue;

            const key = m.seeakkFieldKey;
            if (key === 'name') leadInput.name = val;
            else if (key === 'email') leadInput.email = val;
            else if (key === 'phone') leadInput.phone = val;
            else if (key === 'companyName') leadInput.companyName = val;
            else if (key === 'address') leadInput.address = val;
            else if (key === 'remarks') leadInput.remarks = `${leadInput.remarks}\n${val}`;
            else if (key === 'totalAmount') leadInput.totalAmount = Number(val) || 0;
            else if (key.startsWith('dynamic:')) {
              const fieldId = key.replace('dynamic:', '');
              dynamicValues.push({ fieldId, value: val });
            }
          }

          if (dynamicValues.length > 0) {
            leadInput.dynamicValues = dynamicValues;
          }

          // Apply configured Lead Stage
          if (formConfig.defaultLeadStageId) {
            leadInput.stageId = formConfig.defaultLeadStageId;
          }

          // Apply configured Lead Source
          if (formConfig.leadSourceId) {
            leadInput.sourceId = formConfig.leadSourceId;
          }

          // Apply configured Lead Assignment
          if (formConfig.assignmentType === 'SPECIFIC_USER' && formConfig.assignmentUserId) {
            leadInput.assignedToId = formConfig.assignmentUserId;
          } else if (formConfig.assignmentType === 'ROUND_ROBIN' && formConfig.roundRobinUserIds) {
            try {
              const userIds: string[] = JSON.parse(formConfig.roundRobinUserIds);
              if (userIds.length > 0) {
                const assignedUserId = userIds[roundRobinCounter % userIds.length];
                roundRobinCounter++;
                leadInput.assignedToId = assignedUserId;
              }
            } catch (err) {}
          }

          // Execute Seeakk system lead creation
          const systemActor = { id: formConfig.metaPageConnection?.metaConnection?.connectedByUserId || 'system', role: { name: 'SYSTEM' } };
          const { lead } = await createLead(workspaceId, systemActor as any, leadInput);

          try {
            const { eventDispatcher } = await import('../../automation/eventDispatcher');
            void eventDispatcher.dispatch('meta.lead_resolved', {
              workspaceId,
              recordId: lead.id,
              recordType: 'Lead',
              newData: lead,
            });
          } catch (e: any) {
            logger.error('Failed to dispatch meta.lead_resolved event', { error: e.message });
          }

          // Update MetaLeadImport record
          await (prisma as any).metaLeadImport.update({
            where: { id: importRecord.id },
            data: {
              status: 'IMPORTED',
              leadId: lead.id,
              processedAt: new Date(),
            },
          });

          logger.info('[MetaWebhook] Successfully imported lead from Meta Ads', { workspaceId, leadId: lead.id, metaLeadId });
        } catch (err: any) {
          logger.error('[MetaWebhook] Failed to process Meta lead import', { error: err?.message, importId: importRecord.id });
          await (prisma as any).metaLeadImport.update({
            where: { id: importRecord.id },
            data: {
              status: 'FAILED_RETRYABLE',
              errorCode: 'IMPORT_ERROR',
              errorMessage: err?.message || 'Unknown processing error',
              attemptCount: { increment: 1 },
            },
          });
        }
      }
    }
  }
};

export const getSyncActivity = async (workspaceId: string, limit = 50): Promise<any[]> => {
  const imports = await (prisma as any).metaLeadImport.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      lead: { select: { id: true, name: true, phone: true, email: true, stage: { select: { name: true } }, assignedTo: { select: { name: true } } } },
    },
  });

  return imports.map((item: any) => ({
    id: item.id,
    metaLeadId: item.metaLeadId,
    status: item.status,
    receivedAt: item.receivedAt,
    processedAt: item.processedAt,
    errorMessage: item.errorMessage,
    lead: item.lead,
  }));
};

export const retryFailedImport = async (workspaceId: string, importId: string): Promise<any> => {
  const item = await (prisma as any).metaLeadImport.findFirst({
    where: { id: importId, workspaceId },
  });

  if (!item) throw new Error('Import log not found.');
  if (item.status === 'IMPORTED') throw new Error('Lead is already imported.');

  // Reset status and process
  await (prisma as any).metaLeadImport.update({
    where: { id: importId },
    data: { status: 'PROCESSING', errorMessage: null },
  });

  if (item.rawPayloadJson) {
    const value = JSON.parse(item.rawPayloadJson);
    await processLeadGenWebhook({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value }] }] });
  }

  return { success: true, message: 'Retry initiated successfully.' };
};

export const disconnectMeta = async (workspaceId: string): Promise<any> => {
  await (prisma as any).metaConnection.deleteMany({
    where: { workspaceId },
  });

  return { success: true, message: 'Meta account disconnected safely.' };
};

export const parseAndVerifyMetaSignedRequest = (signedRequest: string): { userId: string; algorithm: string; issuedAt: number } => {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid signed_request format.');
  }

  const [encodedSig, payloadStr] = parts;
  const sig = Buffer.from(encodedSig, 'base64url');
  const payloadJson = Buffer.from(payloadStr, 'base64url').toString('utf8');
  const data = JSON.parse(payloadJson);

  if (!data || data.algorithm !== 'HMAC-SHA256') {
    throw new Error('Unsupported signature algorithm in signed_request.');
  }

  const expectedSig = crypto
    .createHmac('sha256', META_APP_SECRET || 'seeakk-meta-secret')
    .update(payloadStr)
    .digest();

  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
    throw new Error('Invalid signature verification failed for Meta signed_request.');
  }

  return {
    userId: String(data.user_id || data.user_id || ''),
    algorithm: data.algorithm,
    issuedAt: Number(data.issued_at || 0),
  };
};

export const processMetaSignedDataDeletion = async (signedRequest: string): Promise<{ url: string; confirmation_code: string }> => {
  const verified = parseAndVerifyMetaSignedRequest(signedRequest);
  const metaUserId = verified.userId;

  const confirmationCode = crypto.createHash('sha256').update(`${metaUserId}:${Date.now()}`).digest('hex').substring(0, 16);

  if (metaUserId) {
    const connections = await (prisma as any).metaConnection.findMany({
      where: { metaUserId },
      select: { id: true, workspaceId: true },
    });

    for (const conn of connections) {
      await (prisma as any).metaConnection.deleteMany({
        where: { id: conn.id },
      });
      logger.info('[MetaIntegration] Successfully processed Meta Data Deletion callback for workspace', {
        workspaceId: conn.workspaceId,
        metaUserId,
      });
    }
  }

  const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || 'https://www.seeakk.com';
  const trackingUrl = `${baseUrl.replace(/\/+$/, '')}/data-deletion?code=${confirmationCode}`;

  return {
    url: trackingUrl,
    confirmation_code: confirmationCode,
  };
};
