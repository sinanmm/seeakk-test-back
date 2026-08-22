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
  return `${baseUrl}/api/integrations/meta/oauth/callback`;
};

// -----------------------------------------------------------------------------
// 1. OAUTH & CONNECTION MANAGEMENT
// -----------------------------------------------------------------------------

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

  // 1. Exchange code for access token
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
  const meRes = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(
      userAccessToken,
    )}`,
  );
  const meData = (await meRes.json()) as any;
  const metaUserId = meData.id || 'unknown';
  const metaUserName = meData.name || 'Meta User';

  const encryptedUserToken = encryptToken(userAccessToken);

  // 4. Save/Update MetaConnection matching workspaceId + metaUserId (Multi-Account Support)
  const existingConn = await (prisma as any).metaConnection.findFirst({
    where: { workspaceId, metaUserId },
  });

  let metaConnectionId: string;

  if (existingConn) {
    const updated = await (prisma as any).metaConnection.update({
      where: { id: existingConn.id },
      data: {
        name: `${metaUserName} (${metaUserId})`,
        metaUserName,
        status: 'CONNECTED',
        accessTokenEncrypted: encryptedUserToken,
        tokenExpiresAt,
        connectedByUserId: userId,
        lastHealthCheckAt: new Date(),
        lastError: null,
      },
    });
    metaConnectionId = updated.id;
  } else {
    const newConn = await (prisma as any).metaConnection.create({
      data: {
        workspaceId,
        metaUserId,
        metaUserName,
        name: `${metaUserName} (${metaUserId})`,
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
  await fetchAndCachePagesForConnection(workspaceId, metaConnectionId, userAccessToken);

  return { success: true, message: `Meta account "${metaUserName}" connected successfully.` };
};

export const getMetaConnections = async (workspaceId: string): Promise<any[]> => {
  const connections = await (prisma as any).metaConnection.findMany({
    where: { workspaceId },
    include: {
      pages: {
        select: {
          id: true,
          metaPageId: true,
          pageName: true,
          pictureUrl: true,
          status: true,
          subscribedToLeadgen: true,
        },
      },
      automations: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return connections.map((conn: any) => {
    let tokenStatus = conn.status;
    if (conn.tokenExpiresAt && new Date(conn.tokenExpiresAt).getTime() <= Date.now()) {
      tokenStatus = 'EXPIRED';
    }

    return {
      id: conn.id,
      name: conn.name || conn.metaUserName || 'Meta Connection',
      metaUserId: conn.metaUserId,
      metaUserName: conn.metaUserName,
      metaBusinessId: conn.metaBusinessId,
      status: tokenStatus,
      tokenExpiresAt: conn.tokenExpiresAt,
      pagesCount: conn.pages.length,
      automationsCount: conn.automations.length,
      lastHealthCheckAt: conn.lastHealthCheckAt,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
      createdAt: conn.createdAt,
      pages: conn.pages,
    };
  });
};

export const disconnectMetaConnection = async (workspaceId: string, connectionId: string): Promise<any> => {
  const conn = await (prisma as any).metaConnection.findFirst({
    where: { id: connectionId, workspaceId },
  });

  if (!conn) {
    throw new Error('Meta connection not found in this workspace.');
  }

  // Mark connection disconnected and disable automations
  await (prisma as any).$transaction([
    (prisma as any).metaConnection.update({
      where: { id: connectionId },
      data: { status: 'DISCONNECTED', lastError: 'Disconnected by user' },
    }),
    (prisma as any).metaAutomation.updateMany({
      where: { connectionId, workspaceId },
      data: { isActive: false },
    }),
  ]);

  return { success: true, message: 'Meta connection disconnected successfully.' };
};

// -----------------------------------------------------------------------------
// 2. PAGES, FORMS & FORM QUESTIONS DISCOVERY
// -----------------------------------------------------------------------------

export const fetchAndCachePagesForConnection = async (
  workspaceId: string,
  connectionId: string,
  userAccessToken?: string,
): Promise<any[]> => {
  const conn = await (prisma as any).metaConnection.findFirst({
    where: { id: connectionId, workspaceId },
  });

  if (!conn) {
    throw new Error('Meta connection not found.');
  }

  const token = userAccessToken || (conn.accessTokenEncrypted ? decryptToken(conn.accessTokenEncrypted) : null);
  if (!token) {
    throw new Error('Meta access token unavailable. Please reconnect account.');
  }

  // Handle Graph API pagination for Pages
  let pagesList: any[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts?fields=id,name,access_token,picture{url}&limit=100&access_token=${encodeURIComponent(
    token,
  )}`;

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data = (await res.json()) as any;

    if (!res.ok || data.error) {
      const msg = data.error?.message || 'Failed to fetch Facebook Pages from Graph API.';
      await (prisma as any).metaConnection.update({
        where: { id: connectionId },
        data: { status: 'RECONNECT_REQUIRED', lastError: msg },
      });
      throw new Error(msg);
    }

    if (data.data && Array.isArray(data.data)) {
      pagesList = pagesList.concat(data.data);
    }

    nextUrl = data.paging?.next || null;
  }

  const cachedPages: any[] = [];

  for (const page of pagesList) {
    const encryptedPageToken = encryptToken(page.access_token);
    const pictureUrl = page.picture?.data?.url || null;

    const existingPage = await (prisma as any).metaPageConnection.findFirst({
      where: { metaConnectionId: connectionId, metaPageId: page.id },
    });

    if (existingPage) {
      const updated = await (prisma as any).metaPageConnection.update({
        where: { id: existingPage.id },
        data: {
          pageName: page.name,
          pictureUrl,
          pageAccessTokenEncrypted: encryptedPageToken,
          status: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
      cachedPages.push(updated);
    } else {
      const created = await (prisma as any).metaPageConnection.create({
        data: {
          workspaceId,
          metaConnectionId: connectionId,
          metaPageId: page.id,
          pageName: page.name,
          pictureUrl,
          pageAccessTokenEncrypted: encryptedPageToken,
          status: 'ACTIVE',
          lastSyncedAt: new Date(),
        },
      });
      cachedPages.push(created);
    }
  }

  await (prisma as any).metaConnection.update({
    where: { id: connectionId },
    data: { lastHealthCheckAt: new Date(), status: 'CONNECTED', lastError: null },
  });

  return cachedPages;
};

export const getPagesForConnection = async (
  workspaceId: string,
  connectionId: string,
  forceRefresh = false,
): Promise<any[]> => {
  if (forceRefresh) {
    return await fetchAndCachePagesForConnection(workspaceId, connectionId);
  }

  const pages = await (prisma as any).metaPageConnection.findMany({
    where: { workspaceId, metaConnectionId: connectionId, status: 'ACTIVE' },
    orderBy: { pageName: 'asc' },
  });

  if (pages.length === 0) {
    return await fetchAndCachePagesForConnection(workspaceId, connectionId);
  }

  return pages.map((p: any) => ({
    id: p.id,
    metaPageId: p.metaPageId,
    pageName: p.pageName,
    pictureUrl: p.pictureUrl,
    subscribedToLeadgen: p.subscribedToLeadgen,
    status: p.status,
  }));
};

export const getFormsForPage = async (
  workspaceId: string,
  pageId: string,
  forceRefresh = false,
): Promise<any[]> => {
  const page = await (prisma as any).metaPageConnection.findFirst({
    where: { id: pageId, workspaceId },
  });

  if (!page) {
    throw new Error('Facebook Page not found in this workspace.');
  }

  if (!forceRefresh) {
    const cachedForms = await (prisma as any).metaLeadForm.findMany({
      where: { workspaceId, metaPageConnectionId: pageId },
      orderBy: { createdAt: 'desc' },
    });

    if (cachedForms.length > 0) {
      return cachedForms.map((f: any) => ({
        id: f.id,
        metaFormId: f.metaFormId,
        formName: f.formName,
        enabled: f.enabled,
      }));
    }
  }

  // Fetch live Lead Forms from Meta Graph API
  const pageAccessToken = decryptToken(page.pageAccessTokenEncrypted);
  if (!pageAccessToken) {
    throw new Error('Page access token unavailable.');
  }

  let formsList: any[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${page.metaPageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${encodeURIComponent(
    pageAccessToken,
  )}`;

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data = (await res.json()) as any;

    if (!res.ok || data.error) {
      const errorMsg = data.error?.message || 'Failed to fetch Lead Forms for Facebook Page.';
      throw new Error(errorMsg);
    }

    if (data.data && Array.isArray(data.data)) {
      formsList = formsList.concat(data.data);
    }

    nextUrl = data.paging?.next || null;
  }

  const resultForms: any[] = [];

  for (const form of formsList) {
    const existingForm = await (prisma as any).metaLeadForm.findFirst({
      where: { workspaceId, metaPageConnectionId: pageId, metaFormId: form.id },
    });

    if (existingForm) {
      const updated = await (prisma as any).metaLeadForm.update({
        where: { id: existingForm.id },
        data: { formName: form.name },
      });
      resultForms.push(updated);
    } else {
      const created = await (prisma as any).metaLeadForm.create({
        data: {
          workspaceId,
          metaPageConnectionId: pageId,
          metaFormId: form.id,
          formName: form.name,
          enabled: true,
        },
      });
      resultForms.push(created);
    }
  }

  return resultForms.map((f: any) => ({
    id: f.id,
    metaFormId: f.metaFormId,
    formName: f.formName,
    enabled: f.enabled,
  }));
};

export const getFormFields = async (
  workspaceId: string,
  pageId: string,
  metaFormId: string,
): Promise<Array<{ id: string; key: string; label: string; type: string }>> => {
  const page = await (prisma as any).metaPageConnection.findFirst({
    where: { id: pageId, workspaceId },
  });

  if (!page) {
    throw new Error('Facebook Page connection not found.');
  }

  const pageAccessToken = decryptToken(page.pageAccessTokenEncrypted);
  if (!pageAccessToken) {
    throw new Error('Page access token unavailable.');
  }

  const formRes = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${metaFormId}?fields=id,name,questions&access_token=${encodeURIComponent(
      pageAccessToken,
    )}`,
  );
  const formData = (await formRes.json()) as any;

  if (!formRes.ok || formData.error) {
    const msg = formData.error?.message || 'Failed to fetch form questions from Meta Graph API.';
    throw new Error(msg);
  }

  const questions: any[] = formData.questions || [];
  const fields: Array<{ id: string; key: string; label: string; type: string }> = [];

  for (const q of questions) {
    const key = String(q.key || q.id || '').toLowerCase();
    const label = String(q.label || q.key || 'Question');
    const type = String(q.type || 'TEXT');

    fields.push({
      id: q.id || key,
      key,
      label,
      type,
    });
  }

  // Guarantee standard default fields if questions array is empty
  if (fields.length === 0) {
    fields.push(
      { id: 'full_name', key: 'full_name', label: 'Full Name', type: 'FULL_NAME' },
      { id: 'phone_number', key: 'phone_number', label: 'Phone Number', type: 'PHONE_NUMBER' },
      { id: 'email', key: 'email', label: 'Email Address', type: 'EMAIL' },
    );
  }

  return fields;
};

// -----------------------------------------------------------------------------
// 3. META LEAD AUTOMATIONS CRUD & EXECUTIONS
// -----------------------------------------------------------------------------

export const getAutomations = async (workspaceId: string): Promise<any[]> => {
  const automations = await (prisma as any).metaAutomation.findMany({
    where: { workspaceId, deletedAt: null },
    include: {
      connection: { select: { id: true, name: true, metaUserName: true, status: true } },
      page: { select: { id: true, metaPageId: true, pageName: true, pictureUrl: true } },
      mappings: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return automations.map((a: any) => ({
    id: a.id,
    name: a.name,
    isActive: a.isActive,
    connectionId: a.connectionId,
    connectionName: a.connection?.name || a.connection?.metaUserName || 'Meta Connection',
    connectionStatus: a.connection?.status,
    pageId: a.pageId,
    metaPageId: a.page?.metaPageId,
    pageName: a.page?.pageName || 'Facebook Page',
    pagePictureUrl: a.page?.pictureUrl,
    metaFormId: a.metaFormId,
    metaFormName: a.metaFormName,
    mappingCount: a.mappings.length,
    leadsReceivedCount: a.leadsReceivedCount,
    lastLeadAt: a.lastLeadAt,
    lastSuccessAt: a.lastSuccessAt,
    lastErrorAt: a.lastErrorAt,
    lastError: a.lastError,
    createdAt: a.createdAt,
  }));
};

export const getAutomationById = async (workspaceId: string, id: string): Promise<any> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      connection: true,
      page: true,
      mappings: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!automation) {
    throw new Error('Meta Lead Automation not found.');
  }

  return {
    id: automation.id,
    name: automation.name,
    isActive: automation.isActive,
    connectionId: automation.connectionId,
    connectionName: automation.connection?.name || automation.connection?.metaUserName,
    pageId: automation.pageId,
    metaPageId: automation.page?.metaPageId,
    pageName: automation.page?.pageName,
    metaFormId: automation.metaFormId,
    metaFormName: automation.metaFormName,
    leadsReceivedCount: automation.leadsReceivedCount,
    lastLeadAt: automation.lastLeadAt,
    mappings: automation.mappings.map((m: any) => ({
      id: m.id,
      destinationKey: m.destinationKey,
      sourceType: m.sourceType,
      sourceKey: m.sourceKey,
      staticValue: m.staticValue,
      sortOrder: m.sortOrder,
    })),
  };
};

export const subscribePageToLeadGenWebhook = async (pageAccessToken: string, pageId: string): Promise<boolean> => {
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(
      pageAccessToken,
    )}`;
    const res = await fetch(url, { method: 'POST' });
    const data = (await res.json()) as any;
    if (res.ok && data.success) {
      logger.info('[MetaWebhook] Successfully subscribed Page to leadgen webhook', { pageId });
      return true;
    }
  } catch (err: any) {
    logger.error('[MetaWebhook] Failed to subscribe Page to leadgen webhook', { pageId, error: err?.message });
  }
  return false;
};

export const createAutomation = async (
  workspaceId: string,
  userId: string,
  payload: {
    name: string;
    connectionId: string;
    pageId: string;
    metaFormId: string;
    metaFormName: string;
    isActive?: boolean;
    mappings: Array<{
      destinationKey: string;
      sourceType: 'FIELD' | 'STATIC' | 'SYSTEM';
      sourceKey?: string;
      staticValue?: string;
    }>;
  },
): Promise<any> => {
  const connection = await (prisma as any).metaConnection.findFirst({
    where: { id: payload.connectionId, workspaceId },
  });
  if (!connection) throw new Error('Meta connection not found.');

  const page = await (prisma as any).metaPageConnection.findFirst({
    where: { id: payload.pageId, workspaceId },
  });
  if (!page) throw new Error('Facebook Page connection not found.');

  const automation = await (prisma as any).metaAutomation.create({
    data: {
      workspaceId,
      createdById: userId,
      name: payload.name.trim(),
      connectionId: payload.connectionId,
      pageId: payload.pageId,
      metaFormId: payload.metaFormId,
      metaFormName: payload.metaFormName.trim(),
      isActive: payload.isActive !== false,
      mappings: {
        create: payload.mappings.map((m, idx) => ({
          destinationKey: m.destinationKey,
          sourceType: m.sourceType || 'FIELD',
          sourceKey: m.sourceKey || null,
          staticValue: m.staticValue || null,
          sortOrder: idx,
        })),
      },
    },
    include: { mappings: true },
  });

  // Subscribe Page to leadgen webhook
  const pageAccessToken = decryptToken(page.pageAccessTokenEncrypted);
  if (pageAccessToken) {
    const subscribed = await subscribePageToLeadGenWebhook(pageAccessToken, page.metaPageId);
    if (subscribed) {
      await (prisma as any).metaPageConnection.update({
        where: { id: page.id },
        data: { subscribedToLeadgen: true },
      });
    }
  }

  return automation;
};

export const updateAutomation = async (
  workspaceId: string,
  id: string,
  payload: {
    name?: string;
    isActive?: boolean;
    mappings?: Array<{
      destinationKey: string;
      sourceType: 'FIELD' | 'STATIC' | 'SYSTEM';
      sourceKey?: string;
      staticValue?: string;
    }>;
  },
): Promise<any> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!automation) throw new Error('Meta Lead Automation not found.');

  const updatedData: any = {};
  if (payload.name !== undefined) updatedData.name = payload.name.trim();
  if (payload.isActive !== undefined) updatedData.isActive = payload.isActive;

  const updated = await (prisma as any).metaAutomation.update({
    where: { id },
    data: updatedData,
  });

  if (payload.mappings && Array.isArray(payload.mappings)) {
    await (prisma as any).metaAutomationMapping.deleteMany({
      where: { automationId: id },
    });

    await (prisma as any).metaAutomationMapping.createMany({
      data: payload.mappings.map((m, idx) => ({
        automationId: id,
        destinationKey: m.destinationKey,
        sourceType: m.sourceType || 'FIELD',
        sourceKey: m.sourceKey || null,
        staticValue: m.staticValue || null,
        sortOrder: idx,
      })),
    });
  }

  return updated;
};

export const deleteAutomation = async (workspaceId: string, id: string): Promise<any> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!automation) throw new Error('Meta Lead Automation not found.');

  await (prisma as any).metaAutomation.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  return { success: true, message: 'Automation deleted successfully.' };
};

export const duplicateAutomation = async (workspaceId: string, userId: string, id: string): Promise<any> => {
  const original = await getAutomationById(workspaceId, id);

  return await createAutomation(workspaceId, userId, {
    name: `${original.name} (Copy)`,
    connectionId: original.connectionId,
    pageId: original.pageId,
    metaFormId: original.metaFormId,
    metaFormName: original.metaFormName,
    isActive: false,
    mappings: original.mappings.map((m: any) => ({
      destinationKey: m.destinationKey,
      sourceType: m.sourceType,
      sourceKey: m.sourceKey,
      staticValue: m.staticValue,
    })),
  });
};

export const toggleAutomationStatus = async (workspaceId: string, id: string, isActive: boolean): Promise<any> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!automation) throw new Error('Meta Lead Automation not found.');

  const updated = await (prisma as any).metaAutomation.update({
    where: { id },
    data: { isActive },
  });

  return { success: true, isActive: updated.isActive };
};

export const testAutomation = async (workspaceId: string, id: string): Promise<any> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      connection: true,
      page: true,
      mappings: true,
    },
  });

  if (!automation) throw new Error('Automation not found.');

  const checklist = [
    {
      name: 'Meta Account Connected',
      passed: automation.connection?.status === 'CONNECTED',
      message: automation.connection?.status === 'CONNECTED' ? 'Account active & authenticated' : 'Meta connection expired or disconnected',
    },
    {
      name: 'Facebook Page Accessible',
      passed: automation.page?.status === 'ACTIVE',
      message: automation.page?.status === 'ACTIVE' ? `Page "${automation.page.pageName}" active` : 'Page token invalid or access lost',
    },
    {
      name: 'Lead Form Configured',
      passed: Boolean(automation.metaFormId && automation.metaFormName),
      message: automation.metaFormName ? `Form "${automation.metaFormName}" linked` : 'Form missing',
    },
    {
      name: 'Webhook Subscribed',
      passed: Boolean(automation.page?.subscribedToLeadgen),
      message: automation.page?.subscribedToLeadgen ? 'Page subscribed to leadgen webhook' : 'Page webhook subscription pending',
    },
    {
      name: 'Field Mappings Present',
      passed: automation.mappings.length > 0,
      message: `${automation.mappings.length} field mappings configured`,
    },
    {
      name: 'Required CRM Fields Mapped',
      passed: automation.mappings.some((m: any) => m.destinationKey === 'name' || m.destinationKey === 'phone'),
      message: automation.mappings.some((m: any) => m.destinationKey === 'name' || m.destinationKey === 'phone')
        ? 'Name/Phone field mapping present'
        : 'Warning: Neither Name nor Phone is mapped',
    },
    {
      name: 'Automation Enabled',
      passed: Boolean(automation.isActive),
      message: automation.isActive ? 'Automation is active & ready to receive leads' : 'Automation is disabled',
    },
  ];

  const ready = checklist.every((c) => c.passed);

  return {
    automationId: id,
    automationName: automation.name,
    ready,
    checklist,
  };
};

export const getAutomationLogs = async (workspaceId: string, limit = 50): Promise<any[]> => {
  const runs = await (prisma as any).metaAutomationRun.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      automation: { select: { id: true, name: true, metaFormName: true, page: { select: { pageName: true } } } },
      crmLead: { select: { id: true, name: true, phone: true, email: true } },
    },
  });

  return runs.map((run: any) => ({
    id: run.id,
    automationId: run.automationId,
    automationName: run.automation?.name,
    pageName: run.automation?.page?.pageName,
    formName: run.automation?.metaFormName,
    leadgenId: run.leadgenId,
    status: run.status,
    attempts: run.attempts,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    crmLead: run.crmLead,
  }));
};

export const retryAutomationRun = async (workspaceId: string, runId: string): Promise<any> => {
  const run = await (prisma as any).metaAutomationRun.findFirst({
    where: { id: runId, workspaceId },
    include: { automation: true },
  });

  if (!run) throw new Error('Automation run record not found.');
  if (run.status === 'SUCCESS') throw new Error('Automation run already succeeded.');

  await (prisma as any).metaAutomationRun.update({
    where: { id: runId },
    data: { status: 'PROCESSING', errorMessage: null, attempts: { increment: 1 } },
  });

  // Re-process lead from Meta Graph API
  void processLeadById(run.workspaceId, run.automationId, run.leadgenId, run.id).catch((err) => {
    logger.error('[MetaIntegration] Retry lead processing failed', { runId, error: err?.message });
  });

  return { success: true, message: 'Retry initiated successfully.' };
};

// -----------------------------------------------------------------------------
// 4. WEBHOOK VERIFICATION & INGESTION ENGINE
// -----------------------------------------------------------------------------

export const handleWebhookVerification = (mode: string, verifyToken: string, challenge: string): string => {
  if (mode === 'subscribe' && verifyToken === META_WEBHOOK_VERIFY_TOKEN) {
    return challenge;
  }
  throw new Error('Webhook verification failed: verify_token mismatch.');
};

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
      const adId = value.ad_id ? String(value.ad_id) : null;
      const adsetId = value.adset_id ? String(value.adset_id) : null;
      const campaignId = value.campaign_id ? String(value.campaign_id) : null;
      const createdTime = value.created_time ? new Date(value.created_time * 1000) : new Date();

      logger.info('[MetaWebhook] meta.webhook.leadgen.received', {
        leadgen_id: metaLeadId,
        page_id: metaPageId,
        form_id: metaFormId,
      });

      // Save raw webhook event
      try {
        await (prisma as any).metaWebhookEvent.create({
          data: {
            pageId: metaPageId,
            formId: metaFormId,
            leadgenId: metaLeadId,
            payloadJson: JSON.stringify(value),
            processingStatus: 'PROCESSED',
            processedAt: new Date(),
          },
        });
      } catch (err: any) {
        logger.warn('[MetaWebhook] Could not persist raw webhook event', { error: err?.message });
      }

      // Find matching active automations across workspaces matching page_id and metaFormId
      const automations = await (prisma as any).metaAutomation.findMany({
        where: {
          metaFormId,
          isActive: true,
          deletedAt: null,
          page: { metaPageId },
        },
        include: {
          connection: true,
          page: true,
          mappings: { orderBy: { sortOrder: 'asc' } },
        },
      });

      if (automations.length === 0) {
        // Fallback: check legacy MetaLeadForm config
        await processLegacyMetaLeadForm(metaLeadId, metaPageId, metaFormId, value);
        continue;
      }

      for (const automation of automations) {
        await processLeadForAutomation(automation, metaLeadId, metaPageId, metaFormId, {
          adId,
          adsetId,
          campaignId,
          createdTime,
          rawPayload: value,
        });
      }
    }
  }
};

export const processLeadById = async (
  workspaceId: string,
  automationId: string,
  leadgenId: string,
  runId?: string,
): Promise<void> => {
  const automation = await (prisma as any).metaAutomation.findFirst({
    where: { id: automationId, workspaceId, deletedAt: null },
    include: {
      connection: true,
      page: true,
      mappings: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!automation) throw new Error('Automation not found.');

  await processLeadForAutomation(automation, leadgenId, automation.page.metaPageId, automation.metaFormId, {
    createdTime: new Date(),
    runId,
  });
};

const processLeadForAutomation = async (
  automation: any,
  metaLeadId: string,
  metaPageId: string,
  metaFormId: string,
  metaData: { adId?: string | null; adsetId?: string | null; campaignId?: string | null; createdTime?: Date; rawPayload?: any; runId?: string },
): Promise<void> => {
  const workspaceId = automation.workspaceId;

  // Idempotency check: Unique constraint on meta_automation_runs (automationId, leadgenId)
  let runRecord: any;
  try {
    if (metaData.runId) {
      runRecord = await (prisma as any).metaAutomationRun.findUnique({ where: { id: metaData.runId } });
    } else {
      runRecord = await (prisma as any).metaAutomationRun.create({
        data: {
          workspaceId,
          automationId: automation.id,
          leadgenId: metaLeadId,
          status: 'PROCESSING',
        },
      });
    }
  } catch (err: any) {
    logger.info('[MetaWebhook] meta.lead.duplicate_skipped', {
      workspace_id: workspaceId,
      automation_id: automation.id,
      leadgen_id: metaLeadId,
    });
    return;
  }

  try {
    const pageAccessToken = decryptToken(automation.page?.pageAccessTokenEncrypted);
    if (!pageAccessToken) {
      throw new Error('Page access token unavailable or decryption failed.');
    }

    const leadRes = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${metaLeadId}?access_token=${encodeURIComponent(pageAccessToken)}`,
    );
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

    // Default lead values
    const leadInput: any = {
      name: 'Meta Lead',
      remarks: `Imported via Meta Lead Ads (Form: ${automation.metaFormName})`,
    };

    const mappings = automation.mappings || [];
    const dynamicValues: Array<{ fieldId: string; value: string }> = [];

    // Apply Automation Field Mappings
    for (const m of mappings) {
      let val: string | undefined;

      if (m.sourceType === 'STATIC') {
        val = m.staticValue || undefined;
      } else if (m.sourceType === 'SYSTEM') {
        const sysKey = (m.sourceKey || '').toUpperCase();
        if (sysKey === 'PAGE_NAME') val = automation.page?.pageName;
        else if (sysKey === 'PAGE_ID') val = metaPageId;
        else if (sysKey === 'FORM_NAME') val = automation.metaFormName;
        else if (sysKey === 'FORM_ID') val = metaFormId;
        else if (sysKey === 'META_LEAD_ID') val = metaLeadId;
        else if (sysKey === 'AD_ID') val = metaData.adId || undefined;
        else if (sysKey === 'ADSET_ID') val = metaData.adsetId || undefined;
        else if (sysKey === 'CAMPAIGN_ID') val = metaData.campaignId || undefined;
        else if (sysKey === 'CONNECTION_NAME') val = automation.connection?.name;
      } else {
        // FIELD
        val = fieldMap.get((m.sourceKey || '').toLowerCase());
      }

      if (!val || !val.trim()) continue;
      val = val.trim();

      const key = m.destinationKey;
      if (key === 'name') {
        leadInput.name = val;
      } else if (key === 'phone' || key === 'mobile') {
        leadInput.phone = val.replace(/[^\d+]/g, '');
      } else if (key === 'email') {
        leadInput.email = val.toLowerCase();
      } else if (key === 'companyName') {
        leadInput.companyName = val;
      } else if (key === 'address') {
        leadInput.address = val;
      } else if (key === 'remarks') {
        leadInput.remarks = `${leadInput.remarks}\n${val}`;
      } else if (key === 'totalAmount') {
        leadInput.totalAmount = Number(val) || 0;
      } else if (key === 'stageId') {
        leadInput.stageId = val;
      } else if (key === 'sourceId') {
        leadInput.sourceId = val;
      } else if (key === 'assignedToId') {
        leadInput.assignedToId = val;
      } else if (key.startsWith('dynamic:')) {
        const fieldId = key.replace('dynamic:', '');
        dynamicValues.push({ fieldId, value: val });
      }
    }

    // Default Source if not mapped
    if (!leadInput.sourceId) {
      const defaultSource = await (prisma as any).leadSource.findFirst({
        where: { workspaceId, name: { contains: 'Meta', mode: 'insensitive' } },
        select: { id: true },
      });
      if (defaultSource) {
        leadInput.sourceId = defaultSource.id;
      } else {
        const createdSource = await (prisma as any).leadSource.create({
          data: { workspaceId, name: 'Meta Ads', status: 'ACTIVE' },
        });
        leadInput.sourceId = createdSource.id;
      }
    }

    if (dynamicValues.length > 0) {
      leadInput.dynamicValues = dynamicValues;
    }

    // Execute Seeakk system lead creation with escalated privileges
    const systemActor = {
      id: automation.createdById || automation.connection?.connectedByUserId || 'system',
      email: 'system@automation.seeakk.com',
      role: { id: 'system_role', name: 'superadmin' },
      roleId: 'system_role',
      permissions: ['*'],
    };

    const { lead } = await createLead(workspaceId, systemActor as any, leadInput);

    logger.info('[MetaWebhook] meta.lead.created', {
      workspace_id: workspaceId,
      lead_id: lead.id,
      automation_id: automation.id,
      leadgen_id: metaLeadId,
    });

    // Update Automation Run & Statistics
    await (prisma as any).$transaction([
      (prisma as any).metaAutomationRun.update({
        where: { id: runRecord.id },
        data: {
          status: 'SUCCESS',
          crmLeadId: lead.id,
          completedAt: new Date(),
        },
      }),
      (prisma as any).metaAutomation.update({
        where: { id: automation.id },
        data: {
          leadsReceivedCount: { increment: 1 },
          lastLeadAt: new Date(),
          lastSuccessAt: new Date(),
        },
      }),
    ]);

    try {
      const { eventDispatcher } = await import('../../automation/eventDispatcher');
      void eventDispatcher.dispatch('meta.lead_resolved', {
        workspaceId,
        recordId: lead.id,
        recordType: 'Lead',
        newData: lead,
      });
    } catch (e: any) {}
  } catch (err: any) {
    logger.error('[MetaWebhook] Automation lead processing failed', {
      automationId: automation.id,
      leadgenId: metaLeadId,
      error: err?.message,
    });

    if (runRecord?.id) {
      await (prisma as any).metaAutomationRun.update({
        where: { id: runRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: err?.message || 'Processing failed',
          completedAt: new Date(),
        },
      });
    }

    await (prisma as any).metaAutomation.update({
      where: { id: automation.id },
      data: { lastErrorAt: new Date(), lastError: err?.message || 'Processing failed' },
    });
  }
};

const processLegacyMetaLeadForm = async (
  metaLeadId: string,
  metaPageId: string,
  metaFormId: string,
  value: any,
): Promise<void> => {
  const forms = await (prisma as any).metaLeadForm.findMany({
    where: { metaFormId, enabled: true },
    include: {
      metaPageConnection: { include: { metaConnection: true } },
      fieldMappings: true,
    },
  });

  if (forms.length === 0) return;

  for (const formConfig of forms) {
    const workspaceId = formConfig.workspaceId;

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
      continue;
    }

    try {
      const pageAccessTokenEncrypted = formConfig.metaPageConnection?.pageAccessTokenEncrypted;
      const pageAccessToken = pageAccessTokenEncrypted ? decryptToken(pageAccessTokenEncrypted) : null;
      if (!pageAccessToken) throw new Error('Page access token unavailable.');

      const leadRes = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${metaLeadId}?access_token=${encodeURIComponent(pageAccessToken)}`,
      );
      const leadData = (await leadRes.json()) as any;
      if (!leadRes.ok || leadData.error) throw new Error(leadData.error?.message || 'Failed to fetch lead data.');

      const fieldData: Array<{ name: string; values: string[] }> = leadData.field_data || [];
      const fieldMap = new Map<string, string>();
      for (const fd of fieldData) {
        if (fd.name && Array.isArray(fd.values) && fd.values.length > 0) {
          fieldMap.set(fd.name.toLowerCase(), fd.values[0]);
        }
      }

      const leadInput: any = {
        name: 'Meta Lead',
        remarks: `Imported via Meta Lead Ads (Form: ${formConfig.formName})`,
      };

      const mappings = formConfig.fieldMappings || [];
      for (const m of mappings) {
        const val = fieldMap.get(m.metaFieldName.toLowerCase());
        if (!val) continue;
        const key = m.seeakkFieldKey;
        if (key === 'name') leadInput.name = val;
        else if (key === 'email') leadInput.email = val;
        else if (key === 'phone') leadInput.phone = val;
        else if (key === 'companyName') leadInput.companyName = val;
        else if (key === 'address') leadInput.address = val;
      }

      if (formConfig.defaultLeadStageId) leadInput.stageId = formConfig.defaultLeadStageId;
      if (formConfig.leadSourceId) leadInput.sourceId = formConfig.leadSourceId;

      const systemActor = {
        id: formConfig.metaPageConnection?.metaConnection?.connectedByUserId || 'system',
        email: 'system@automation.seeakk.com',
        role: { id: 'system_role', name: 'superadmin' },
        roleId: 'system_role',
        permissions: ['*'],
      };

      const { lead } = await createLead(workspaceId, systemActor as any, leadInput);

      await (prisma as any).metaLeadImport.update({
        where: { id: importRecord.id },
        data: { status: 'IMPORTED', leadId: lead.id, processedAt: new Date() },
      });
    } catch (err: any) {
      await (prisma as any).metaLeadImport.update({
        where: { id: importRecord.id },
        data: { status: 'FAILED_RETRYABLE', errorMessage: err?.message },
      });
    }
  }
};

// -----------------------------------------------------------------------------
// 5. SIGNED REQUEST & DATA DELETION (META COMPLIANCE)
// -----------------------------------------------------------------------------

export const parseAndVerifyMetaSignedRequest = (signedRequest: string): { userId: string; algorithm: string; issuedAt: number } => {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) throw new Error('Invalid signed_request format.');

  const [encodedSig, payloadStr] = parts;
  const sig = Buffer.from(encodedSig, 'base64url');
  const payloadJson = Buffer.from(payloadStr, 'base64url').toString('utf8');
  const data = JSON.parse(payloadJson);

  if (!data || data.algorithm !== 'HMAC-SHA256') {
    throw new Error('Unsupported signature algorithm in signed_request.');
  }

  const expectedSig = crypto.createHmac('sha256', META_APP_SECRET || 'seeakk-meta-secret').update(payloadStr).digest();

  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
    throw new Error('Invalid signature verification failed for Meta signed_request.');
  }

  return {
    userId: String(data.user_id || ''),
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
      await (prisma as any).metaConnection.deleteMany({ where: { id: conn.id } });
      logger.info('[MetaIntegration] Processed Meta Data Deletion callback', { workspaceId: conn.workspaceId, metaUserId });
    }
  }

  const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || 'https://www.seeakk.com';
  const trackingUrl = `${baseUrl.replace(/\/+$/, '')}/data-deletion?code=${confirmationCode}`;

  return { url: trackingUrl, confirmation_code: confirmationCode };
};
