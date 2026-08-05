import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import * as controller from './callTracking.controller';

const router = Router();

router.use(protect);

router.post(
  '/:leadId/calls/initiate',
  checkAnyPermission(['CALL_OUTCOMES_CREATE', 'LEADS_EDIT', 'LEADS_VIEW_ALL', 'LEADS_VIEW_TEAM', 'LEADS_VIEW_OWN']),
  controller.initiateCall,
);

router.get(
  '/:leadId/calls/active',
  checkAnyPermission(['CALL_OUTCOMES_VIEW', 'LEADS_VIEW_ALL', 'LEADS_VIEW_TEAM', 'LEADS_VIEW_OWN']),
  controller.getActiveCallSession,
);

router.post(
  '/:leadId/calls/outcome',
  checkAnyPermission(['CALL_OUTCOMES_CREATE', 'LEADS_EDIT', 'LEADS_VIEW_ALL', 'LEADS_VIEW_TEAM', 'LEADS_VIEW_OWN']),
  controller.saveCallOutcome,
);

export default router;
