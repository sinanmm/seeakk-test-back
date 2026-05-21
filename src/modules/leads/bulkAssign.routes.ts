import { Router } from 'express';
import { checkPermission, protect } from '../../middlewares/authMiddleware';
import { checkUserLock } from '../../middlewares/lockMiddleware';
import * as bulkAssignController from './bulkAssign.controller';

const router = Router();

router.use(protect);
router.use(checkUserLock);
// Apply LEADS_BULK_ASSIGN only on bulk-assign endpoints. A router-level checkPermission
// would run for every /api/leads request (this router is mounted before leadRoutes),
// incorrectly requiring bulk-assign permission for normal lead CRUD.

router.post(
  '/bulk-assign/preview',
  checkPermission('LEADS_BULK_ASSIGN'),
  bulkAssignController.previewBulkAssign,
);
router.post('/bulk-assign', checkPermission('LEADS_BULK_ASSIGN'), bulkAssignController.bulkAssign);

export default router;
