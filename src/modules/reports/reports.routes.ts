import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as reportsController from './reports.controller';
import summaryReportsRoutes from './summary/summaryReports.routes';

const router = Router();

router.use('/summary', summaryReportsRoutes);

router.post('/', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.createReport);
router.get('/', protect, checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']), reportsController.listReports);
router.put('/:id', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.updateReport);
router.post('/generate', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.generateReport);
router.post('/:id/generate', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.generateSavedReport);
router.get('/:id/download', protect, checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']), reportsController.downloadReport);
router.delete('/:id', protect, checkAnyPermission(['REPORTS_GENERATE', 'REPORTS_VIEW']), reportsController.deleteReport);
router.get('/logs', protect, checkAnyPermission(['REPORT_LOGS_VIEW', 'REPORT_TYPE_MANAGE']), reportsController.listReportLogs);

export default router;
