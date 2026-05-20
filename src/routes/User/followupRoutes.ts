import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as followupController from '../../controllers/User/followupController';

const router = Router();

router.get('/calendar/advanced/summary', protect, followupController.getAdvancedCalendarSummary);
router.get('/calendar/advanced/details', protect, followupController.getAdvancedCalendarDetails);
router.get('/calendar', protect, followupController.getCalendarData);
router.get('/today', protect, followupController.getTodayFollowUps);
router.get('/mandatory-continuation', protect, followupController.getMandatoryFollowUpContinuation);
router.post('/mandatory-continuation', protect, followupController.saveMandatoryFollowUpContinuation);
router.get('/alerts', protect, followupController.getReminderAlerts);
router.get('/history', protect, followupController.getHistory);
router.post('/', protect, followupController.createFollowUp);
router.post('/:id/complete', protect, followupController.completeFollowUp);
router.patch('/:id/snooze', protect, followupController.snoozeFollowUp);

export default router;
