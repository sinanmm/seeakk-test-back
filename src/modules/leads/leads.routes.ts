import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as leadsController from './leads.controller';

const router = Router();

router.use(protect);

router.get('/closed/export', leadsController.exportClosedLeads);
router.get('/closed', leadsController.listClosedLeads);
router.patch('/:id/closure', leadsController.updateClosure);
router.patch('/:id/reopen', leadsController.reopenLead);

export default router;
