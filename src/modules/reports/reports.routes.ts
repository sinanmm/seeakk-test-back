import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import { requireModule } from '../../middlewares/moduleGuard';
import * as reportsController from './reports.controller';
import summaryReportsRoutes from './summary/summaryReports.routes';

const router = Router();

router.use(protect);
router.use(requireModule('REPORTS'));

router.use('/summary', summaryReportsRoutes);

router.post('/', checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.createReport);
router.get('/', checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']), reportsController.listReports);
router.put('/:id', checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.updateReport);
router.post('/generate', checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.generateReport);
router.post('/:id/generate', checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.generateSavedReport);
router.get('/:id/download', checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']), reportsController.downloadReport);
router.delete('/:id', checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.deleteReport);
router.get('/logs', checkAnyPermission(['REPORT_LOGS_VIEW', 'REPORT_TYPE_MANAGE']), reportsController.listReportLogs);

export default router;
