import { Router } from 'express';
import { authorize, checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as leadLifeCycleController from '../../controllers/User/leadLifeCycleController';

const router = Router();

router.use(protect);

router.get(
  '/',
  checkAnyPermission([
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  leadLifeCycleController.listLifeCycles,
);

router.get(
  '/stage-options',
  checkAnyPermission([
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
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
