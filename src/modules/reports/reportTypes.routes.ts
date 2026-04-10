import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import * as reportTypesController from './reportTypes.controller';

const router = Router();

router.get('/', protect, checkAnyPermission(['REPORTS_VIEW', 'REPORT_TYPE_MANAGE']), reportTypesController.listReportTypes);
router.post('/', protect, checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.createReportType);
router.put('/:id', protect, checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.updateReportType);
router.patch('/:id/status', protect, checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.toggleReportTypeStatus);
router.delete('/:id', protect, checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.deleteReportType);

export default router;
