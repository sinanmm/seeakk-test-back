import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';

const ATTENDANCE_PERMISSIONS = [
  { key: 'view_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'View own attendance' },
  { key: 'mark_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'Mark daily attendance' },
  { key: 'manage_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'Manage employee attendance' },
  { key: 'view_all_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'View all employee attendance' },
  { key: 'export_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'Export attendance reports' },
  { key: 'unlock_attendance_locked_users', group: 'ATTENDANCE_MANAGEMENT', description: 'Unlock users locked by attendance/target systems' },
  { key: 'approve_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'Approve supervised staff attendance requests' },
  { key: 'reject_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'Reject supervised staff attendance requests' },
  { key: 'view_pending_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'View pending attendance queue' },
  { key: 'view_own_attendance', group: 'ATTENDANCE_MANAGEMENT', description: 'View own attendance details' },
  { key: 'manage_attendance_settings', group: 'ATTENDANCE_MANAGEMENT', description: 'Modify workspace attendance time policies' },
  { key: 'manage_attendance_network', group: 'ATTENDANCE_MANAGEMENT', description: 'Manage approved office networks and IPs' },
  { key: 'edit_attendance_apply_type', group: 'ATTENDANCE_MANAGEMENT', description: 'Edit employee attendance apply type settings' },
  { key: 'view_attendance_network_logs', group: 'ATTENDANCE_MANAGEMENT', description: 'View attendance network audit logs' },
];

export const ensureAttendancePermissionsSeeded = async () => {
  logger.info('[Guard] Checking and seeding attendance permissions...');

  try {
    // 1. Seed the permissions in the Permission table
    for (const perm of ATTENDANCE_PERMISSIONS) {
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
      where: { key: { in: ATTENDANCE_PERMISSIONS.map(p => p.key) } },
    });

    const permissionMap = new Map(allDbPermissions.map((p: any) => [p.key, p.id]));

    // 2. Query all roles in the database
    const roles = await (prisma as any).role.findMany();

    for (const role of roles) {
      const roleNameLower = (role.name || '').toLowerCase().trim();
      const isAdminOrSuperAdmin = roleNameLower === 'superadmin' || roleNameLower === 'admin';

      const permissionsToAssign: string[] = [];

      if (isAdminOrSuperAdmin) {
        // Admins and Superadmins get all attendance permissions
        permissionsToAssign.push(...ATTENDANCE_PERMISSIONS.map(p => p.key));
      } else {
        // All other staff/agents get basic view and mark permissions
        permissionsToAssign.push('view_attendance', 'mark_attendance', 'view_own_attendance');
      }

      // Check existing permissions for this role to avoid redundant inserts
      const existingRolePermissions = await (prisma as any).rolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: true },
      });

      const existingKeys = new Set(existingRolePermissions.map((rp: any) => rp.permission.key));

      const missingKeys = permissionsToAssign.filter(key => !existingKeys.has(key));

      if (missingKeys.length > 0) {
        const insertData = missingKeys
          .map(key => {
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
          logger.info(`[Guard] Assigned ${insertData.length} new attendance permissions to role ${role.name} (${role.id})`);
        }
      }

      // 3. Invalidate Redis Permission Cache for this role so changes take effect immediately
      if (redisClient.isOpen) {
        const cacheKey = `role_permissions:${role.id}`;
        await redisClient.del(cacheKey);
      }
    }

    logger.info('[Guard] Attendance permissions auto-seeding & Redis cache invalidation complete.');
  } catch (error: any) {
    logger.error('[Guard] Failed to auto-seed attendance permissions:', error);
  }
};
