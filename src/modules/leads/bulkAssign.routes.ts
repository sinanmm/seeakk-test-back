import { Router } from 'express';
import { checkPermission, protect } from '../../middlewares/authMiddleware';
import * as bulkAssignController from './bulkAssign.controller';

const router = Router();

router.use(protect);
router.use(checkPermission('LEADS_BULK_ASSIGN'));

router.post('/bulk-assign/preview', bulkAssignController.previewBulkAssign);
router.post('/bulk-assign', bulkAssignController.bulkAssign);

export default router;
