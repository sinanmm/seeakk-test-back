import { Router } from 'express';
import { authorize, protect } from '../../middlewares/authMiddleware';
import * as leadLifeCycleController from '../../controllers/User/leadLifeCycleController';

const router = Router();

router.use(protect);

router.get(
  '/',
  authorize('admin', 'super admin', 'super-admin', 'manager'),
  leadLifeCycleController.listLifeCycles,
);

router.get(
  '/stage-options',
  authorize('admin', 'super admin', 'super-admin', 'manager'),
  leadLifeCycleController.getStageOptions,
);

router.get(
  '/:id',
  authorize('admin', 'super admin', 'super-admin', 'manager'),
  leadLifeCycleController.getLifeCycleById,
);

router.post(
  '/',
  authorize('admin', 'super admin', 'super-admin'),
  leadLifeCycleController.createLifeCycle,
);

router.put(
  '/:id',
  authorize('admin', 'super admin', 'super-admin'),
  leadLifeCycleController.updateLifeCycle,
);

router.delete(
  '/:id',
  authorize('admin', 'super admin', 'super-admin'),
  leadLifeCycleController.deleteLifeCycle,
);

export default router;
