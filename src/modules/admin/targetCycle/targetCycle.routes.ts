import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as targetCycleController from './targetCycle.controller';

const router = Router();

router.post(
  '/',
  protect,
  checkPermission('TARGET_CYCLES_CREATE'),
  targetCycleController.createTargetCycle,
);

router.get(
  '/',
  protect,
  checkPermission('TARGET_CYCLES_VIEW'),
  targetCycleController.listTargetCycles,
);

router.get(
  '/:id',
  protect,
  checkPermission('TARGET_CYCLES_VIEW'),
  targetCycleController.getTargetCycleById,
);

router.put(
  '/:id',
  protect,
  checkPermission('TARGET_CYCLES_EDIT'),
  targetCycleController.updateTargetCycle,
);

router.delete(
  '/:id',
  protect,
  checkPermission('TARGET_CYCLES_DELETE'),
  targetCycleController.deleteTargetCycle,
);

export default router;

