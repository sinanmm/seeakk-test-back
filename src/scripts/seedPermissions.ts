import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient() as any;

const permissions = [
  // USERS MANAGEMENT
  { key: 'USERS_VIEW', group: 'ADMIN_MANAGEMENT', description: 'View users list' },
  { key: 'USERS_CREATE', group: 'ADMIN_MANAGEMENT', description: 'Create new users' },
  { key: 'USERS_EDIT', group: 'ADMIN_MANAGEMENT', description: 'Edit existing users' },
  { key: 'USERS_UNLOCK', group: 'ADMIN_MANAGEMENT', description: 'Unlock locked staff accounts' },
  { key: 'USERS_DELETE', group: 'ADMIN_MANAGEMENT', description: 'Soft-delete users' },
  { key: 'USERS_EXPORT', group: 'ADMIN_MANAGEMENT', description: 'Export users to CSV/Excel' },

  // ROLES MANAGEMENT
  { key: 'ROLES_VIEW', group: 'ADMIN_MANAGEMENT', description: 'View roles and permissions' },
  { key: 'ROLES_CREATE', group: 'ADMIN_MANAGEMENT', description: 'Create new roles' },
  { key: 'ROLES_EDIT', group: 'ADMIN_MANAGEMENT', description: 'Edit roles and permissions' },
  { key: 'ROLES_DELETE', group: 'ADMIN_MANAGEMENT', description: 'Delete roles' },

  // DEPARTMENTS MANAGEMENT
  { key: 'DEPARTMENTS_VIEW', group: 'ADMIN_MANAGEMENT', description: 'View departments' },
  { key: 'DEPARTMENTS_CREATE', group: 'ADMIN_MANAGEMENT', description: 'Create new departments' },
  { key: 'DEPARTMENTS_EDIT', group: 'ADMIN_MANAGEMENT', description: 'Edit existing departments' },
  { key: 'DEPARTMENTS_DELETE', group: 'ADMIN_MANAGEMENT', description: 'Delete departments' },

  // MASTER LEAD SOURCES
  { key: 'LEAD_SOURCES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View lead sources' },
  { key: 'LEAD_SOURCES_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create lead sources' },
  { key: 'LEAD_SOURCES_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit lead sources' },
  { key: 'LEAD_SOURCES_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete lead sources' },

  // MASTER LEAD STAGES
  { key: 'LEAD_STAGES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View lead stages' },
  { key: 'LEAD_STAGES_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create lead stages' },
  { key: 'LEAD_STAGES_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit and reorder lead stages' },
  { key: 'LEAD_STAGES_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete lead stages' },

  // MASTER STAGE RULES
  { key: 'LEAD_STAGE_RULES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View stage rules' },
  { key: 'LEAD_STAGE_RULES_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create stage rules' },
  { key: 'LEAD_STAGE_RULES_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit stage rules' },
  { key: 'LEAD_STAGE_RULES_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete stage rules' },

  // MASTER TARGET CYCLES
  { key: 'TARGET_CYCLES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View target cycles' },
  { key: 'TARGET_CYCLES_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create target cycles' },
  { key: 'TARGET_CYCLES_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit target cycles' },
  { key: 'TARGET_CYCLES_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete target cycles' },

  // MASTER LEAD DYNAMICS
  { key: 'LEAD_DYNAMICS_VIEW', group: 'MASTER_CONFIGURATION', description: 'View lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete lead dynamic fields' },
  { key: 'LOB_REASONS_VIEW', group: 'MASTER_CONFIGURATION', description: 'View LOB reasons' },
  { key: 'LOB_REASONS_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create LOB reasons' },
  { key: 'LOB_REASONS_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit LOB reasons' },
  { key: 'LOB_REASONS_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete LOB reasons' },
  { key: 'LOCATION_VIEW', group: 'MASTER_CONFIGURATION', description: 'View countries, levels, and locations' },
  { key: 'LOCATION_MANAGE', group: 'MASTER_CONFIGURATION', description: 'Create and manage countries, levels, and locations' },

  // LEADS MANAGEMENT
  { key: 'LEADS_VIEW_ALL', group: 'LEADS_MANAGEMENT', description: 'View all leads' },
  { key: 'LEADS_VIEW_OWN', group: 'LEADS_MANAGEMENT', description: 'View only own leads' },
  { key: 'LEADS_VIEW_TEAM', group: 'LEADS_MANAGEMENT', description: 'View team leads' },
  { key: 'LEADS_CREATE', group: 'LEADS_MANAGEMENT', description: 'Create new leads' },
  { key: 'LEADS_EDIT', group: 'LEADS_MANAGEMENT', description: 'Edit leads' },
  { key: 'LEADS_DELETE', group: 'LEADS_MANAGEMENT', description: 'Delete leads' },
  { key: 'LEADS_ASSIGN', group: 'LEADS_MANAGEMENT', description: 'Assign leads to users' },
  { key: 'LEADS_BULK_ASSIGN', group: 'LEADS_MANAGEMENT', description: 'Bulk assign leads' },
  { key: 'LEAD_APPROVAL_VIEW', group: 'LEADS_MANAGEMENT', description: 'View lead stage approvals' },
  { key: 'LEAD_APPROVAL_APPROVE', group: 'LEADS_MANAGEMENT', description: 'Approve lead stage requests' },
  { key: 'LEAD_APPROVAL_DENY', group: 'LEADS_MANAGEMENT', description: 'Deny lead stage requests' },
  { key: 'LEADS_APPROVE', group: 'LEADS_MANAGEMENT', description: 'Approve lead conversions' },
  { key: 'LEADS_REJECT', group: 'LEADS_MANAGEMENT', description: 'Reject leads' },
  { key: 'LEADS_CLOSE', group: 'LEADS_MANAGEMENT', description: 'Close leads' },
  { key: 'LEADS_REOPEN', group: 'LEADS_MANAGEMENT', description: 'Reopen closed leads' },
  { key: 'LEADS_EXPORT', group: 'LEADS_MANAGEMENT', description: 'Export leads data' },
  { key: 'LEADS_IMPORT', group: 'LEADS_MANAGEMENT', description: 'Import leads from external files' },

  // OTHER MODULES (Future proofing)
  { key: 'FINANCE_VIEW', group: 'MASTER_CONFIGURATION', description: 'View finance records' },
  { key: 'INVENTORY_VIEW', group: 'MASTER_CONFIGURATION', description: 'View inventory' },
  { key: 'REPORT_TYPE_MANAGE', group: 'REPORTS_ANALYTICS', description: 'Create, edit, activate, deactivate, and delete report types' },
  { key: 'REPORTS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View reports' },
  { key: 'REPORTS_GENERATE', group: 'REPORTS_ANALYTICS', description: 'Generate dynamic reports' },
  { key: 'REPORT_LOGS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View report execution logs' },
  { key: 'LOB_ANALYSIS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View LOB analysis dashboards and audit breakdowns' },
  { key: 'SYSTEM_CONFIG', group: 'SYSTEM_SETTINGS', description: 'Manage system settings' },
];

async function syncWorkspaceSuperAdminRoles() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true },
  });

  if (workspaces.length === 0) return;

  const allPermissions = await prisma.permission.findMany({
    select: { id: true },
  });

  for (const workspace of workspaces) {
    const superAdminRole = await prisma.role.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: 'superadmin',
        },
      },
      update: {
        description: 'Workspace Owner with full system access',
        status: 'ACTIVE',
        isSystemRole: true,
      },
      create: {
        workspaceId: workspace.id,
        name: 'superadmin',
        description: 'Workspace Owner with full system access',
        status: 'ACTIVE',
        isSystemRole: true,
      },
    });

    if (allPermissions.length === 0) continue;

    await prisma.rolePermission.createMany({
      data: allPermissions.map((permission: { id: string }) => ({
        roleId: superAdminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }
}

async function main() {
  console.log('Seeding permissions...');
  let failed = 0;

  for (const permission of permissions) {
    try {
      await prisma.permission.upsert({
        where: { key: permission.key },
        update: {
          group: permission.group,
          description: permission.description,
        },
        create: permission,
      });
    } catch (err) {
      failed += 1;
      console.warn(`Failed to seed permission ${permission.key}:`, err);
    }
  }

  if (failed > 0) {
    throw new Error(`Permission seeding failed for ${failed} item(s).`);
  }

  await syncWorkspaceSuperAdminRoles();

  console.log('Permissions seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
