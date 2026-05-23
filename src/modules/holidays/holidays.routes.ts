import { Router } from 'express';
import { protect, checkPermission } from '../../middlewares/authMiddleware';
import * as holidayController from './holidays.controller';

const router = Router();

router.use(protect);

router.get('/', checkPermission('HOLIDAY_VIEW'), holidayController.getAllHolidays);
router.post('/', checkPermission('HOLIDAY_CREATE'), holidayController.createHoliday);
router.patch('/:id', checkPermission('HOLIDAY_UPDATE'), holidayController.updateHoliday);
router.delete('/:id', checkPermission('HOLIDAY_DELETE'), holidayController.deleteHoliday);

router.get('/calendar', checkPermission('HOLIDAY_VIEW'), holidayController.getCalendarView);
router.post('/ai-suggest', checkPermission('HOLIDAY_AI'), holidayController.suggestHolidays);

export default router;
