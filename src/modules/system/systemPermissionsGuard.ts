import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';

const SYSTEM_NEW_PERMISSIONS = [
  // SALARY MANAGEMENT
  { key: 'SALARY_CALCULATION_VIEW', group: 'SALARY_MANAGEMENT', description: 'View salary calculations' },
  { key: 'SALARY_CALCULATION_GENERATE', group: 'SALARY_MANAGEMENT', description: 'Generate employee salary records' },
  { key: 'SALARY_CALCULATION_EDIT', group: 'SALARY_MANAGEMENT', description: 'Edit salary calculations' },
  { key: 'SALARY_CALCULATION_DELETE', group: 'SALARY_MANAGEMENT', description: 'Delete salary calculations' },
  { key: 'SALARY_STAGES_VIEW', group: 'SALARY_MANAGEMENT', description: 'View approval stages' },
  { key: 'SALARY_STAGES_CREATE', group: 'SALARY_MANAGEMENT', description: 'Create approval stages' },
  { key: 'SALARY_STAGES_EDIT', group: 'SALARY_MANAGEMENT', description: 'Edit approval stages' },
  { key: 'SALARY_STAGES_DELETE', group: 'SALARY_MANAGEMENT', description: 'Delete approval stages' },
  { key: 'SALARY_APPROVALS_VIEW', group: 'SALARY_MANAGEMENT', description: 'View pending salary approvals' },
  { key: 'SALARY_APPROVALS_APPROVE', group: 'SALARY_MANAGEMENT', description: 'Approve salary records' },
  { key: 'SALARY_APPROVALS_REJECT', group: 'SALARY_MANAGEMENT', description: 'Reject salary records' },
  { key: 'SALARY_APPROVALS_RETURN', group: 'SALARY_MANAGEMENT', description: 'Return salary records for correction' },
  { key: 'SALARY_APPROVALS_EDIT', group: 'SALARY_MANAGEMENT', description: 'Edit salary before final approval' },

  // OFFICE LOCATION MANAGEMENT
  { key: 'OFFICE_LOCATION_VIEW', group: 'OFFICE_LOCATION', description: 'View office locations' },
  { key: 'OFFICE_LOCATION_CREATE', group: 'OFFICE_LOCATION', description: 'Create office locations' },
  { key: 'OFFICE_LOCATION_EDIT', group: 'OFFICE_LOCATION', description: 'Edit office locations' },
  { key: 'OFFICE_LOCATION_DELETE', group: 'OFFICE_LOCATION', description: 'Delete office locations' },

  // DASHBOARD MANAGEMENT
  { key: 'DASHBOARD_VIEW_OWN', group: 'DASHBOARD', description: 'View Own Dashboard' },
  { key: 'DASHBOARD_VIEW_ASSIGNED', group: 'DASHBOARD', description: 'View Assigned Users Dashboard' },
  { key: 'DASHBOARD_VIEW_ALL', group: 'DASHBOARD', description: 'View All Users Dashboard' },
  { key: 'DASHBOARD_VIEW_OWN_OFFICE', group: 'DASHBOARD', description: 'View Own Office Dashboard' },
  { key: 'DASHBOARD_VIEW_ASSIGNED_OFFICES', group: 'DASHBOARD', description: 'View Assigned Users Offices Dashboard' },
  { key: 'DASHBOARD_VIEW_ALL_OFFICES', group: 'DASHBOARD', description: 'View All Offices Dashboard' },

  // ASSIGNED USERS MANAGEMENT
  { key: 'ASSIGNED_USERS_VIEW', group: 'ASSIGNED_USERS', description: 'View assigned users and assignment details' },
  { key: 'ASSIGNED_USERS_EDIT', group: 'ASSIGNED_USERS', description: 'Update, change, or reassign assigned users' },
  { key: 'ASSIGNED_USERS_DELETE', group: 'ASSIGNED_USERS', description: 'Remove assigned users and delete user assignments' },
];

export const ensureSystemPermissionsSeeded = async () => {
  logger.info('[Guard] Checking and seeding system permissions (Office Location & Dashboard)...');

  try {
    // 1. Seed the permissions in the Permission table
    for (const perm of SYSTEM_NEW_PERMISSIONS) {
      await (prisma as any).permission.upsert({
        where: { key: perm.key },
        update: {
          group: perm.group,
          description: perm.description,
        },
        create: perm,
      });
    }

    const allDbPermissions = await (prisma as any).permission.findMany({
      where: { key: { in: SYSTEM_NEW_PERMISSIONS.map((p) => p.key) } },
    });

    const permissionMap = new Map(allDbPermissions.map((p: any) => [p.key, p.id]));

    // 2. Query all roles in the database
    const roles = await (prisma as any).role.findMany();

    for (const role of roles) {
      const roleNameLower = (role.name || '').toLowerCase().trim();
      const isAdminOrSuperAdmin = roleNameLower === 'superadmin' || roleNameLower === 'admin';

      // Assign new permissions automatically to superadmin and admin roles
      if (isAdminOrSuperAdmin) {
        const existingRolePermissions = await (prisma as any).rolePermission.findMany({
          where: { roleId: role.id },
          include: { permission: true },
        });

        const existingKeys = new Set(existingRolePermissions.map((rp: any) => rp.permission.key));
        const missingKeys = SYSTEM_NEW_PERMISSIONS.map((p) => p.key).filter((key) => !existingKeys.has(key));

        if (missingKeys.length > 0) {
          const insertData = missingKeys
            .map((key) => {
              const permissionId = permissionMap.get(key);
              if (!permissionId) return null;
              return {
                roleId: role.id,
                permissionId,
              };
            })
            .filter(Boolean) as { roleId: string; permissionId: string }[];

          if (insertData.length > 0) {
            await (prisma as any).rolePermission.createMany({
              data: insertData,
              skipDuplicates: true,
            });
            logger.info(
              `[Guard] Assigned ${insertData.length} new system permissions to role ${role.name} (${role.id})`,
            );
          }
        }
      }

      // 3. Invalidate Redis Permission Cache for this role
      if (redisClient.isOpen) {
        const cacheKey = `role_permissions:${role.id}`;
        await redisClient.del(cacheKey);
      }
    }

    logger.info('[Guard] System permissions auto-seeding & Redis cache invalidation complete.');
  } catch (error: any) {
    logger.error('[Guard] Failed to auto-seed system permissions:', error);
  }
};
