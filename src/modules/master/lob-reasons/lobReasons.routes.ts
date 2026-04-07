import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as lobReasonsController from './lobReasons.controller';

const router = Router();

router.get(
  '/',
  protect,
  checkAnyPermission(['LOB_REASONS_VIEW', 'LOB_REASONS_CREATE', 'LOB_REASONS_EDIT', 'LOB_REASONS_DELETE', 'LEADS_CREATE', 'LEADS_EDIT']),
  lobReasonsController.listLOBReasons,
);
router.post('/', protect, checkPermission('LOB_REASONS_CREATE'), lobReasonsController.createLOBReason);
router.put('/:id', protect, checkPermission('LOB_REASONS_EDIT'), lobReasonsController.updateLOBReason);
router.patch('/:id/status', protect, checkPermission('LOB_REASONS_EDIT'), lobReasonsController.toggleLOBReasonStatus);
router.delete('/:id', protect, checkPermission('LOB_REASONS_DELETE'), lobReasonsController.deleteLOBReason);

export default router;
