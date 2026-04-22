import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as followupController from '../../controllers/User/followupController';

const router = Router();

router.get('/calendar', protect, followupController.getCalendarData);
router.get('/today', protect, followupController.getTodayFollowUps);
router.get('/alerts', protect, followupController.getReminderAlerts);
router.get('/history', protect, followupController.getHistory);
router.post('/', protect, followupController.createFollowUp);
router.post('/:id/complete', protect, followupController.completeFollowUp);
router.patch('/:id/snooze', protect, followupController.snoozeFollowUp);

export default router;
