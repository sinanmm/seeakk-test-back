import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import { resolveAttendanceWorkspace } from './attendance.middleware';
import * as controller from './attendance.controller';

const router = Router();

router.use(protect);
router.use(resolveAttendanceWorkspace);

router.get('/today', controller.getTodayStatusController);
router.post('/check-in', controller.markAttendanceController);
router.post('/checkout', controller.checkOutAttendanceController);
router.post('/check-out', controller.checkOutAttendanceController);
router.get('/history', checkPermission('view_attendance'), controller.getHistoryController);
router.get('/stats', checkPermission('view_attendance'), controller.getStatsController);
router.get('/notifications', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getNotificationsController);

router.get(
  '/pending',
  checkAnyPermission(['approve_attendance', 'view_pending_attendance', 'ATTENDANCE_APPROVE']),
  controller.getPendingApprovalsController,
);
router.post(
  '/review/:recordId',
  checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.reviewAttendanceController,
);
router.post(
  '/approve/:recordId',
  checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.approveAttendanceController,
);
router.post(
  '/reject/:recordId',
  checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.rejectAttendanceController,
);
router.post(
  '/clarification/:recordId',
  checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.requestClarificationController,
);
router.get(
  '/approval-history',
  checkAnyPermission(['approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.getApprovalHistoryController,
);
router.get(
  '/schedules',
  checkAnyPermission(['manage_attendance_settings', 'approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.getSchedulesController,
);
router.get(
  '/schedules/:userId',
  checkAnyPermission(['manage_attendance_settings', 'approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.getScheduleController,
);
router.post(
  '/schedules/:userId',
  checkAnyPermission(['manage_attendance_settings', 'approve_attendance', 'ATTENDANCE_APPROVE']),
  controller.updateScheduleController,
);

router.put('/apply-type/:userId', checkPermission('edit_attendance_apply_type'), controller.updateUserApplyTypeController);
router.put(
  '/office-branch/:userId',
  checkAnyPermission(['assign_office_branch', 'edit_attendance_apply_type', 'manage_attendance_locations']),
  controller.updateUserOfficeBranchController,
);
router.get('/user-settings', checkPermission('manage_attendance_settings'), controller.getAttendanceUserSettingsController);
router.put('/user-settings/:userId', checkPermission('manage_attendance_settings'), controller.updateAttendanceUserSettingController);
router.post('/unlock/:userId', checkPermission('unlock_attendance_locked_users'), controller.unlockUserController);

router.get('/settings', checkPermission('manage_attendance_settings'), controller.getSettingsController);
router.put('/settings', checkPermission('manage_attendance_settings'), controller.updateSettingsController);

router.get('/locations', checkAnyPermission(['OFFICE_LOCATION_VIEW', 'manage_attendance_locations', 'manage_attendance_network']), controller.getOfficeLocationsController);
router.post('/locations', checkAnyPermission(['OFFICE_LOCATION_CREATE', 'manage_attendance_locations', 'manage_attendance_network']), controller.createOfficeLocationController);
router.put('/locations/:id', checkAnyPermission(['OFFICE_LOCATION_EDIT', 'manage_attendance_locations', 'manage_attendance_network']), controller.updateOfficeLocationController);
router.delete('/locations/:id', checkAnyPermission(['OFFICE_LOCATION_DELETE', 'manage_attendance_locations', 'manage_attendance_network']), controller.deleteOfficeLocationController);

router.get('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.getNetworksController);
router.post('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.createNetworkController);
router.put('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.updateNetworkController);
router.delete('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.deleteNetworkController);

router.get('/admin-overview', checkPermission('view_all_attendance'), controller.getAdminOverviewController);
router.get('/admin-stats', checkPermission('view_all_attendance'), controller.getAdminStatsController);
router.get('/export', checkPermission('export_attendance'), controller.exportController);

export default router;
