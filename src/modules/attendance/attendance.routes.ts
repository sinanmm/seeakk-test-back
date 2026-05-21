import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as controller from './attendance.controller';

const router = Router();

router.use(protect);

// Standard Employee Routes
router.get('/today', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getTodayStatusController);
router.post(
  '/check-in',
  checkAnyPermission(['mark_attendance', 'view_attendance', 'view_own_attendance', 'manage_attendance']),
  controller.markAttendanceController,
);
router.get('/history', checkPermission('view_attendance'), controller.getHistoryController);
router.get('/stats', checkPermission('view_attendance'), controller.getStatsController);
router.get('/notifications', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getNotificationsController);

// Supervisor / Admin Approval Queue
router.get('/pending', checkAnyPermission(['approve_attendance', 'view_pending_attendance']), controller.getPendingApprovalsController);
router.post('/review/:recordId', checkPermission('approve_attendance'), controller.reviewAttendanceController);

// User list management routes
router.put('/apply-type/:userId', checkPermission('edit_attendance_apply_type'), controller.updateUserApplyTypeController);
router.post('/unlock/:userId', checkPermission('unlock_attendance_locked_users'), controller.unlockUserController);

// Settings and network policies configuration
router.get('/settings', checkPermission('manage_attendance_settings'), controller.getSettingsController);
router.put('/settings', checkPermission('manage_attendance_settings'), controller.updateSettingsController);

router.get('/networks', checkPermission('manage_attendance_network'), controller.getNetworksController);
router.post('/networks', checkPermission('manage_attendance_network'), controller.createNetworkController);
router.put('/networks/:id', checkPermission('manage_attendance_network'), controller.updateNetworkController);
router.delete('/networks/:id', checkPermission('manage_attendance_network'), controller.deleteNetworkController);

// General logs & exports
router.get('/admin-overview', checkPermission('view_all_attendance'), controller.getAdminOverviewController);
router.get('/admin-stats', checkPermission('view_all_attendance'), controller.getAdminStatsController);
router.get('/export', checkPermission('export_attendance'), controller.exportController);

export default router;
