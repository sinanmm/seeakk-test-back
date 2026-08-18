import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
import {
  ALL_DEFAULT_DASHBOARD_ITEMS,
  type DashboardItemType,
} from './dashboardPreferences.constants';
import type {
  DashboardPreferenceItem,
  DashboardPreferencesPayload,
  UpdateDashboardPreferencesInput,
} from './dashboardPreferences.types';

export const checkActorPermissions = (actor: any) => {
  const permissions: string[] = actor?.permissions || [];
  const roleName = typeof actor?.role === 'string' ? actor.role : actor?.role?.name || '';
  const isSuperadmin = permissions.includes('SUPERADMIN') || roleName === 'SUPERADMIN';

  const CUSTOMIZE_PERMISSIONS = [
    'DASHBOARD_CUSTOMIZE',
    'DASHBOARD_CUSTOM_MANAGE_SECTIONS',
    'DASHBOARD_CUSTOM_CREATE_OWN',
    'SYSTEM_CONFIG',
  ];

  const RENAME_PERMISSIONS = [
    'DASHBOARD_RENAME',
    'DASHBOARD_CUSTOM_MANAGE_SECTIONS',
    'SYSTEM_CONFIG',
  ];

  const canCustomize = isSuperadmin || CUSTOMIZE_PERMISSIONS.some((p) => permissions.includes(p));
  const canRename = isSuperadmin || RENAME_PERMISSIONS.some((p) => permissions.includes(p));

  return { canCustomize, canRename };
};

export const getWorkspaceDashboardPreferences = async (
  workspaceId: string,
  actor: any
): Promise<DashboardPreferencesPayload> => {
  const { canCustomize, canRename } = checkActorPermissions(actor);

  const savedPreferences: any[] = await (prisma as any).dashboardLayoutPreference.findMany({
    where: { workspaceId },
  });

  const savedMap = new Map<string, any>(savedPreferences.map((pref: any) => [pref.itemKey, pref]));

  const mergedCards: DashboardPreferenceItem[] = [];
  const mergedSections: DashboardPreferenceItem[] = [];

  for (const defaultItem of ALL_DEFAULT_DASHBOARD_ITEMS) {
    const saved = savedMap.get(defaultItem.key);
    const customTitle = saved?.customTitle?.trim() || null;
    const item: DashboardPreferenceItem = {
      key: defaultItem.key,
      type: defaultItem.type,
      defaultTitle: defaultItem.defaultTitle,
      displayTitle: customTitle || defaultItem.defaultTitle,
      customTitle: customTitle,
      displayOrder: saved ? saved.displayOrder : defaultItem.defaultOrder,
      isVisible: saved ? saved.isVisible : defaultItem.defaultVisible,
    };

    if (defaultItem.type === 'CARD') {
      mergedCards.push(item);
    } else {
      mergedSections.push(item);
    }
  }

  mergedCards.sort((a, b) => a.displayOrder - b.displayOrder);
  mergedSections.sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    cards: mergedCards,
    sections: mergedSections,
    canCustomize,
    canRename,
  };
};

export const updateWorkspaceDashboardPreferences = async (
  workspaceId: string,
  actor: any,
  input: UpdateDashboardPreferencesInput
): Promise<DashboardPreferencesPayload> => {
  const { canCustomize, canRename } = checkActorPermissions(actor);

  if (!canCustomize) {
    const err: any = new Error('You do not have permission to customize the dashboard layout.');
    err.statusCode = 403;
    throw err;
  }

  const validKeys = new Set(ALL_DEFAULT_DASHBOARD_ITEMS.map((item) => item.key));
  const validItems = (input.items || []).filter((item) => validKeys.has(item.key));

  if (validItems.length > 0) {
    const hasVisibleItem = validItems.some((item) => item.isVisible);
    if (!hasVisibleItem) {
      const err: any = new Error('At least one dashboard card or section must remain visible.');
      err.statusCode = 400;
      throw err;
    }
  }

  await (prisma as any).$transaction(
    validItems.map((item) => {
      let customTitle: string | null = null;

      if (canRename && item.customTitle !== undefined && item.customTitle !== null) {
        const trimmed = item.customTitle.trim();
        customTitle = trimmed.length > 0 ? trimmed.slice(0, 100) : null;
      }

      return (prisma as any).dashboardLayoutPreference.upsert({
        where: {
          workspaceId_itemKey: {
            workspaceId,
            itemKey: item.key,
          },
        },
        create: {
          workspaceId,
          itemKey: item.key,
          itemType: item.type as any,
          isVisible: Boolean(item.isVisible),
          displayOrder: Number(item.displayOrder) || 1,
          customTitle: customTitle,
          updatedByUserId: actor?.id || null,
        },
        update: {
          isVisible: Boolean(item.isVisible),
          displayOrder: Number(item.displayOrder) || 1,
          ...(canRename ? { customTitle } : {}),
          updatedByUserId: actor?.id || null,
        },
      });
    })
  );

  try {
    if (auditService && typeof auditService.log === 'function') {
      await auditService.log({
        userId: actor?.id || null,
        workspaceId,
        action: 'DASHBOARD_CUSTOMIZED',
        entityType: 'Workspace',
        entityId: workspaceId,
        details: {
          itemCount: validItems.length,
        },
      });
    }
  } catch (auditErr) {
    logger.warn('Failed to record dashboard customization audit log:', auditErr);
  }

  return getWorkspaceDashboardPreferences(workspaceId, actor);
};

export const resetWorkspaceDashboardPreferences = async (
  workspaceId: string,
  actor: any
): Promise<DashboardPreferencesPayload> => {
  const { canCustomize } = checkActorPermissions(actor);

  if (!canCustomize) {
    const err: any = new Error('You do not have permission to reset dashboard preferences.');
    err.statusCode = 403;
    throw err;
  }

  await (prisma as any).dashboardLayoutPreference.deleteMany({
    where: { workspaceId },
  });

  try {
    if (auditService && typeof auditService.log === 'function') {
      await auditService.log({
        userId: actor?.id || null,
        workspaceId,
        action: 'DASHBOARD_RESET',
        entityType: 'Workspace',
        entityId: workspaceId,
        details: {
          message: 'Dashboard reset to default configuration',
        },
      });
    }
  } catch (auditErr) {
    logger.warn('Failed to record dashboard reset audit log:', auditErr);
  }

  return getWorkspaceDashboardPreferences(workspaceId, actor);
};
