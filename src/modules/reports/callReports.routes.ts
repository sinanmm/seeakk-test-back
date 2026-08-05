import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import * as controller from './callReports.controller';

const router = Router();

router.use(protect);

router.get(
  '/summary',
  checkAnyPermission(['CALL_REPORTS_VIEW_ALL', 'CALL_REPORTS_VIEW_ASSIGNED', 'CALL_REPORTS_VIEW_OWN', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  controller.getCallSummaryReport,
);

router.get(
  '/detailed',
  checkAnyPermission(['CALL_REPORTS_VIEW_ALL', 'CALL_REPORTS_VIEW_ASSIGNED', 'CALL_REPORTS_VIEW_OWN', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  controller.getCallDetailedReport,
);

router.post(
  '/export',
  checkAnyPermission(['CALL_REPORTS_EXPORT', 'LEADS_EXPORT', 'REPORTS_GENERATE', 'SYSTEM_CONFIG']),
  controller.exportCallReport,
);

export default router;
