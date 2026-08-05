import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient() as any;

const permissions = [
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

  // USERS MANAGEMENT
  { key: 'USERS_VIEW', group: 'ADMIN_MANAGEMENT', description: 'View users list' },
  { key: 'USERS_CREATE', group: 'ADMIN_MANAGEMENT', description: 'Create new users' },
  { key: 'USERS_EDIT', group: 'ADMIN_MANAGEMENT', description: 'Edit existing users' },
  { key: 'USERS_UNLOCK', group: 'ADMIN_MANAGEMENT', description: 'Unlock locked staff accounts' },
  { key: 'USERS_DELETE', group: 'ADMIN_MANAGEMENT', description: 'Soft-delete users' },
  { key: 'USERS_EXPORT', group: 'ADMIN_MANAGEMENT', description: 'Export users to CSV/Excel' },
  { key: 'USERS_ASSIGN_SUPERVISOR', group: 'ADMIN_MANAGEMENT', description: 'Assign or change user supervisor' },

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
  { key: 'manage_target_cycles', group: 'MASTER_CONFIGURATION', description: 'Manage target cycle performance engine' },
  { key: 'assign_target_cycles', group: 'ADMIN_MANAGEMENT', description: 'Assign target cycles to users' },
  { key: 'view_target_analytics', group: 'ADMIN_MANAGEMENT', description: 'View target analytics and reports' },
  { key: 'lock_users_by_target', group: 'ADMIN_MANAGEMENT', description: 'Lock users when targets are incomplete' },
  { key: 'unlock_target_locked_users', group: 'ADMIN_MANAGEMENT', description: 'Unlock target-locked staff accounts' },
  { key: 'extend_target_grace_period', group: 'ADMIN_MANAGEMENT', description: 'Extend target grace periods' },
  { key: 'TARGET_CYCLES_CONFIGURE_SELF_UNLOCK', group: 'MASTER_CONFIGURATION', description: 'Configure target self-unlock rules' },
  { key: 'TARGET_LOCKS_SELF_UNLOCK', group: 'ADMIN_MANAGEMENT', description: 'Self-unlock account on target lock' },
  { key: 'TARGET_CYCLES_CONFIGURE_SUPERVISOR_ESCALATION', group: 'MASTER_CONFIGURATION', description: 'Configure supervisor lock escalation rules' },
  { key: 'target_cycles.configure_self_unlock', group: 'MASTER_CONFIGURATION', description: 'Configure target self-unlock rules (alias)' },
  { key: 'target_locks.self_unlock', group: 'ADMIN_MANAGEMENT', description: 'Self-unlock account on target lock (alias)' },
  { key: 'target_cycles.configure_supervisor_escalation', group: 'MASTER_CONFIGURATION', description: 'Configure supervisor lock escalation rules (alias)' },

  // MASTER LEAD DYNAMICS
  { key: 'LEAD_DYNAMICS_VIEW', group: 'MASTER_CONFIGURATION', description: 'View lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit lead dynamic fields' },
  { key: 'LEAD_DYNAMICS_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete lead dynamic fields' },
  { key: 'LOB_REASONS_VIEW', group: 'MASTER_CONFIGURATION', description: 'View LOB reasons' },
  { key: 'LOB_REASONS_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create LOB reasons' },
  { key: 'LOB_REASONS_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit LOB reasons' },
  { key: 'LOB_REASONS_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete LOB reasons' },
  { key: 'view_followup_extension_reasons', group: 'MASTER_CONFIGURATION', description: 'View follow-up extension reasons' },
  { key: 'manage_followup_extension_reasons', group: 'MASTER_CONFIGURATION', description: 'Manage follow-up extension reasons' },
  { key: 'manage_followup_settings', group: 'ADMIN_MANAGEMENT', description: 'Manage follow-up settings' },
  { key: 'bulk_extend_followups', group: 'ADMIN_MANAGEMENT', description: 'Bulk extend follow-ups' },
  {
    key: 'override_lifecycle_followup_limit',
    group: 'ADMIN_MANAGEMENT',
    description: 'Bypass lifecycle limits when extending follow-ups (logged)',
  },
  { key: 'grant_bulk_extension_access', group: 'ADMIN_MANAGEMENT', description: 'Grant temporary bulk extension access' },
  { key: 'view_followup_capacity', group: 'ADMIN_MANAGEMENT', description: 'View follow-up capacity settings and reports' },
  // HOLIDAY LIST
  { key: 'HOLIDAY_VIEW', group: 'MASTER_CONFIGURATION', description: 'View holidays and weekly-off settings' },
  { key: 'HOLIDAY_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create holidays' },
  { key: 'HOLIDAY_UPDATE', group: 'MASTER_CONFIGURATION', description: 'Update holidays and weekly-off settings' },
  { key: 'HOLIDAY_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete holidays' },
  { key: 'HOLIDAY_AI', group: 'MASTER_CONFIGURATION', description: 'Use AI holiday suggestions' },

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

  // LEAD SUBSTAGES MANAGEMENT
  { key: 'LEAD_SUBSTAGES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View Lead Substages' },
  { key: 'LEAD_SUBSTAGES_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create Lead Substages' },
  { key: 'LEAD_SUBSTAGES_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit Lead Substages' },
  { key: 'LEAD_SUBSTAGES_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete Lead Substages' },
  { key: 'LEAD_SUBSTAGES_TOGGLE', group: 'MASTER_CONFIGURATION', description: 'Activate/Deactivate Lead Substages' },
  { key: 'LEAD_SUBSTAGES_USE', group: 'LEADS_MANAGEMENT', description: 'Use Lead Substages' },

  // CALL OUTCOMES & TRACKING
  { key: 'CALL_OUTCOMES_VIEW', group: 'LEADS_MANAGEMENT', description: 'View Call Outcomes' },
  { key: 'CALL_OUTCOMES_CREATE', group: 'LEADS_MANAGEMENT', description: 'Create Call Outcomes' },
  { key: 'CALL_OUTCOMES_EDIT_OWN', group: 'LEADS_MANAGEMENT', description: 'Edit Own Call Outcomes' },

  // CALL REPORTS & ANALYTICS
  { key: 'CALL_REPORTS_VIEW_OWN', group: 'REPORTS_ANALYTICS', description: 'View Own Call Reports' },
  { key: 'CALL_REPORTS_VIEW_ASSIGNED', group: 'REPORTS_ANALYTICS', description: 'View Assigned Users Call Reports' },
  { key: 'CALL_REPORTS_VIEW_ALL', group: 'REPORTS_ANALYTICS', description: 'View All Call Reports' },
  { key: 'CALL_REPORTS_EXPORT', group: 'REPORTS_ANALYTICS', description: 'Export Call Reports' },
  { key: 'CALL_SUMMARY_VIEW', group: 'REPORTS_ANALYTICS', description: 'View Call Summary' },
  { key: 'CALL_DETAILS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View Call Details' },
  { key: 'CALL_OUTCOME_NOTES_VIEW', group: 'REPORTS_ANALYTICS', description: 'View Call Outcome Notes' },
  { key: 'SUBSTAGE_HISTORY_VIEW', group: 'REPORTS_ANALYTICS', description: 'View Substage Change History' },

  // SHEETS MODULE
  { key: 'SHEETS_VIEW', group: 'SHEETS', description: 'View Sheets module and sheet files' },
  { key: 'SHEETS_CREATE', group: 'SHEETS', description: 'Create blank sheets and duplicate sheets' },
  { key: 'SHEETS_EDIT', group: 'SHEETS', description: 'Edit and save sheet cell values' },
  { key: 'SHEETS_DELETE', group: 'SHEETS', description: 'Delete sheets' },
  { key: 'SHEETS_IMPORT', group: 'SHEETS', description: 'Import CSV/XLS/XLSX files and lead exports into Sheets' },
  { key: 'SHEETS_EXPORT', group: 'SHEETS', description: 'Export sheets to CSV or Excel' },
  { key: 'SHEETS_SYNC_LEADS', group: 'SHEETS', description: 'Validate and synchronize sheet changes back to leads' },
  { key: 'SHEETS_FORMAT_MANAGE', group: 'SHEETS', description: 'Manage sheet formatting and layout' },

  // OTHER MODULES (Future proofing)
  { key: 'PRODUCTS_VIEW', group: 'MASTER_CONFIGURATION', description: 'View product master records' },
  { key: 'PRODUCTS_CREATE', group: 'MASTER_CONFIGURATION', description: 'Create product master records' },
  { key: 'PRODUCTS_EDIT', group: 'MASTER_CONFIGURATION', description: 'Edit, activate, and deactivate product master records' },
  { key: 'PRODUCTS_DELETE', group: 'MASTER_CONFIGURATION', description: 'Delete unused product master records' },
  { key: 'PRODUCT_PRICES_VIEW', group: 'MASTER_CONFIGURATION', description: 'View product pricing in lead workflows' },
  { key: 'FINANCE_VIEW', group: 'MASTER_CONFIGURATION', description: 'View finance records' },
  { key: 'INVENTORY_VIEW', group: 'MASTER_CONFIGURATION', description: 'View inventory' },
  { key: 'REPORT_TYPE_MANAGE', group: 'REPORTS_ANALYTICS', description: 'Create, edit, activate, deactivate, and delete report types' },
  { key: 'REPORTS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View reports' },
  { key: 'REPORTS_GENERATE', group: 'REPORTS_ANALYTICS', description: 'Generate dynamic reports' },
  { key: 'REPORT_LOGS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View report execution logs' },
  { key: 'VIEW_ACTIVITY_REPORTS', group: 'REPORTS_ANALYTICS', description: 'View user activity reports' },
  { key: 'EXPORT_ACTIVITY_REPORTS', group: 'REPORTS_ANALYTICS', description: 'Export user activity reports' },
  { key: 'LOB_ANALYSIS_VIEW', group: 'REPORTS_ANALYTICS', description: 'View LOB analysis dashboards and audit breakdowns' },
  { key: 'VIEW_TOTAL_REVENUE', group: 'REPORTS_ANALYTICS', description: 'View total workspace revenue totals and analytics' },
  { key: 'VIEW_OWN_REVENUE', group: 'REPORTS_ANALYTICS', description: 'View only own generated revenue and analytics' },
  { key: 'SYSTEM_CONFIG', group: 'SYSTEM_SETTINGS', description: 'Manage system settings' },

  // ATTENDANCE MANAGEMENT
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
  { key: 'manage_attendance_network', group: 'ATTENDANCE_MANAGEMENT', description: 'Manage approved office networks and IPs (legacy)' },
  { key: 'manage_attendance_locations', group: 'ATTENDANCE_MANAGEMENT', description: 'Manage office GPS locations and radius' },
  { key: 'assign_office_branch', group: 'ATTENDANCE_MANAGEMENT', description: 'Assign users to office branch locations' },
  { key: 'view_attendance_location_logs', group: 'ATTENDANCE_MANAGEMENT', description: 'View attendance GPS location audit logs' },
  { key: 'edit_attendance_apply_type', group: 'ATTENDANCE_MANAGEMENT', description: 'Edit employee attendance apply type settings' },
  { key: 'view_attendance_network_logs', group: 'ATTENDANCE_MANAGEMENT', description: 'View attendance network audit logs' },
  { key: 'ATTENDANCE_APPROVE', group: 'ATTENDANCE_MANAGEMENT', description: 'Can view attendance summaries and approve/reject attendance records.' },
  { key: 'LOCATION_TRACKING_SHARE', group: 'ATTENDANCE_MANAGEMENT', description: 'Upload own live field location while checked in' },
  { key: 'LOCATION_TRACKING_VIEW_LIVE', group: 'ATTENDANCE_MANAGEMENT', description: 'View live field staff locations' },
  { key: 'LOCATION_TRACKING_VIEW_HISTORY', group: 'ATTENDANCE_MANAGEMENT', description: 'View historical field staff travel routes' },
  { key: 'LOCATION_TRACKING_REPLAY', group: 'ATTENDANCE_MANAGEMENT', description: 'Replay field staff route movement' },
  { key: 'LOCATION_TRACKING_EXPORT', group: 'ATTENDANCE_MANAGEMENT', description: 'Export field staff route reports' },
  { key: 'LOCATION_TRACKING_VIEW_ALL', group: 'ATTENDANCE_MANAGEMENT', description: 'View all users in location tracker' },
  { key: 'LOCATION_TRACKING_VIEW_ASSIGNED', group: 'ATTENDANCE_MANAGEMENT', description: 'View assigned users in location tracker' },
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
