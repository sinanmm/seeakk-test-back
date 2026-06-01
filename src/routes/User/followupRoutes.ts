import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as followupController from '../../controllers/User/followupController';

const router = Router();

router.get('/calendar/advanced/summary', protect, followupController.getAdvancedCalendarSummary);
router.get('/calendar/advanced/details', protect, followupController.getAdvancedCalendarDetails);
router.get('/calendar', protect, followupController.getCalendarData);
router.get('/today', protect, followupController.getTodayFollowUps);
router.get('/lifecycle-extension-limit', protect, followupController.getLifecycleExtensionLimit);
router.get('/overdue-mandatory', protect, followupController.getOverdueMandatoryFollowUps);
router.get('/mandatory-continuation', protect, followupController.getMandatoryFollowUpContinuation);
router.post('/mandatory-continuation', protect, followupController.saveMandatoryFollowUpContinuation);
router.get('/alerts', protect, followupController.getReminderAlerts);
router.get('/history', protect, followupController.getHistory);

router.get('/today-utilization', protect, followupController.getTodayUtilization);
router.post('/bulk-extend', protect, followupController.bulkExtendFollowUps);
router.get('/reports/bulk-extensions', protect, followupController.getBulkExtensionReport);
router.get('/reports/capacity', protect, followupController.getFollowUpCapacityReport);
router.get('/reports/utilization', protect, followupController.getDailyFollowUpUtilization);
router.get('/reports/user-limits', protect, followupController.getUserFollowUpLimitReport);
router.get('/reports/export', protect, followupController.exportReport);

router.post('/', protect, followupController.createFollowUp);
router.post('/:id/complete', protect, followupController.completeFollowUp);
router.patch('/:id/snooze', protect, followupController.snoozeFollowUp);

export default router;
