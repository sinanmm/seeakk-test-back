import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import { resolveAttendanceWorkspace } from './attendance.middleware';
import * as controller from './attendance.controller';

const router = Router();

router.use(protect);

router.get('/today', resolveAttendanceWorkspace, controller.getTodayStatusController);
router.post('/check-in', resolveAttendanceWorkspace, controller.markAttendanceController);
router.post('/checkout', resolveAttendanceWorkspace, controller.checkOutAttendanceController);
router.post('/check-out', resolveAttendanceWorkspace, controller.checkOutAttendanceController);
router.get('/history', checkPermission('view_attendance'), controller.getHistoryController);
router.get('/stats', checkPermission('view_attendance'), controller.getStatsController);
router.get('/notifications', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getNotificationsController);

router.get('/pending', checkAnyPermission(['approve_attendance', 'view_pending_attendance']), controller.getPendingApprovalsController);
router.post('/review/:recordId', checkPermission('approve_attendance'), controller.reviewAttendanceController);
router.post('/approve/:recordId', checkPermission('approve_attendance'), controller.approveAttendanceController);
router.post('/reject/:recordId', checkPermission('approve_attendance'), controller.rejectAttendanceController);

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

router.get('/locations', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.getOfficeLocationsController);
router.post('/locations', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.createOfficeLocationController);
router.put('/locations/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.updateOfficeLocationController);
router.delete('/locations/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.deleteOfficeLocationController);

router.get('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.getNetworksController);
router.post('/networks', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.createNetworkController);
router.put('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.updateNetworkController);
router.delete('/networks/:id', checkAnyPermission(['manage_attendance_locations', 'manage_attendance_network']), controller.deleteNetworkController);

router.get('/admin-overview', checkPermission('view_all_attendance'), controller.getAdminOverviewController);
router.get('/admin-stats', checkPermission('view_all_attendance'), controller.getAdminStatsController);
router.get('/export', checkPermission('export_attendance'), controller.exportController);

export default router;
