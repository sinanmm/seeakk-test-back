import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as reportsController from './reports.controller';

const router = Router();

router.post('/generate', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.generateReport);
router.get('/logs', protect, checkAnyPermission(['REPORT_LOGS_VIEW', 'REPORT_TYPE_MANAGE']), reportsController.listReportLogs);

export default router;
