import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as controller from './attendance.controller';

const router = Router();

router.use(protect);

router.get('/today', checkAnyPermission(['view_attendance', 'mark_attendance']), controller.getTodayStatusController);
router.post('/check-in', checkPermission('mark_attendance'), controller.markAttendanceController);
router.get('/history', checkPermission('view_attendance'), controller.getHistoryController);
router.get('/stats', checkPermission('view_attendance'), controller.getStatsController);

router.get('/admin-overview', checkPermission('view_all_attendance'), controller.getAdminOverviewController);
router.get('/admin-stats', checkPermission('view_all_attendance'), controller.getAdminStatsController);

router.get('/settings', checkPermission('manage_attendance'), controller.getSettingsController);
router.put('/settings', checkPermission('manage_attendance'), controller.updateSettingsController);

router.post('/unlock/:userId', checkPermission('unlock_attendance_locked_users'), controller.unlockUserController);
router.get('/export', checkPermission('export_attendance'), controller.exportController);

export default router;
