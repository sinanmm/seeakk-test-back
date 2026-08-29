import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import { requireModule } from '../../middlewares/moduleGuard';
import * as reportTypesController from './reportTypes.controller';

const router = Router();

router.use(protect);
router.use(requireModule('REPORTS'));

router.get('/', checkAnyPermission(['REPORTS_VIEW', 'REPORT_TYPE_MANAGE']), reportTypesController.listReportTypes);
router.post('/', checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.createReportType);
router.put('/:id', checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.updateReportType);
router.patch('/:id/status', checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.toggleReportTypeStatus);
router.delete('/:id', checkPermission('REPORT_TYPE_MANAGE'), reportTypesController.deleteReportType);

export default router;
