import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import { resolveAttendanceWorkspace } from './attendance.middleware';
import * as controller from './attendance.controller';

const router = Router();

router.use(protect);

// Employee check-in: authenticated + workspace only (every onboarded employee must mark attendance)
router.get('/today', resolveAttendanceWorkspace, controller.getTodayStatusController);
router.post('/check-in', resolveAttendanceWorkspace, controller.markAttendanceController);
router.post('/check-out', resolveAttendanceWorkspace, controller.checkOutController);
router.get('/history', checkPermission('view_attendance'), controller.getHistoryController);
router.get('/stats', checkPermission('view_attendance'), controller.getStatsController);
router.get('/notifications', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getNotificationsController);

// Supervisor / Admin Approval Queue
router.get('/pending', checkAnyPermission(['approve_attendance', 'view_pending_attendance', 'ATTENDANCE_APPROVE']), controller.getPendingApprovalsController);
router.post('/review/:recordId', checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']), controller.reviewAttendanceController);
router.post('/clarification/:recordId', checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']), controller.requestClarificationController);
router.get('/approval-history', checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']), controller.getApprovalHistoryController);

// Schedules routes
router.get('/schedules', checkAnyPermission(['manage_attendance_settings', 'ATTENDANCE_APPROVE']), controller.getSchedulesController);
router.get('/schedules/:userId', checkAnyPermission(['manage_attendance_settings', 'ATTENDANCE_APPROVE']), controller.getScheduleController);
router.post('/schedules/:userId', checkPermission('manage_attendance_settings'), controller.updateScheduleController);

// User list management routes
router.put('/apply-type/:userId', checkPermission('edit_attendance_apply_type'), controller.updateUserApplyTypeController);
router.put(
  '/office-branch/:userId',
  checkAnyPermission(['assign_office_branch', 'edit_attendance_apply_type', 'manage_attendance_locations']),
  controller.updateUserOfficeBranchController,
);
router.post('/unlock/:userId', checkPermission('unlock_attendance_locked_users'), controller.unlockUserController);

// Settings and network policies configuration
router.get('/settings', checkPermission('manage_attendance_settings'), controller.getSettingsController);
router.put('/settings', checkPermission('manage_attendance_settings'), controller.updateSettingsController);

router.get(
  '/locations',
  checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']),
  controller.getOfficeLocationsController,
);
router.post(
  '/locations',
  checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']),
  controller.createOfficeLocationController,
);
router.put(
  '/locations/:id',
  checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']),
  controller.updateOfficeLocationController,
);
router.delete(
  '/locations/:id',
  checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']),
  controller.deleteOfficeLocationController,
);

router.get('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.getNetworksController);
router.post('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.createNetworkController);
router.put('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.updateNetworkController);
router.delete('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.deleteNetworkController);

// General logs & exports
router.get('/admin-overview', checkPermission('view_all_attendance'), controller.getAdminOverviewController);
router.get('/admin-stats', checkPermission('view_all_attendance'), controller.getAdminStatsController);
router.get('/export', checkPermission('export_attendance'), controller.exportController);

export default router;
