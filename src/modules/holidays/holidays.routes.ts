import { Router } from 'express';
import { protect, checkPermission } from '../../middlewares/authMiddleware';
import * as holidayController from './holidays.controller';

const router = Router();

router.use(protect);

// Static paths first (must be registered before /:id routes)
router.get('/calendar', checkPermission('HOLIDAY_VIEW'), holidayController.getCalendarView);
router.get('/weekly-off', holidayController.getWeeklyOffSettings);
router.put('/weekly-off', checkPermission('SYSTEM_CONFIG'), holidayController.updateWeeklyOffSettings);
router.post('/ai-suggest', checkPermission('HOLIDAY_AI'), holidayController.suggestHolidays);

router.get('/', checkPermission('HOLIDAY_VIEW'), holidayController.getAllHolidays);
router.post('/', checkPermission('HOLIDAY_CREATE'), holidayController.createHoliday);
router.patch('/:id', checkPermission('HOLIDAY_UPDATE'), holidayController.updateHoliday);
router.delete('/:id', checkPermission('HOLIDAY_DELETE'), holidayController.deleteHoliday);

export default router;
