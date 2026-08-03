import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import * as targetController from './target.controller';

const router = Router();

router.use(protect);

router.get(
  '/analytics/dashboard',
  checkAnyPermission(['view_target_analytics', 'TARGET_CYCLES_VIEW', 'SYSTEM_CONFIG']),
  targetController.getTargetDashboard,
);

router.get(
  '/analytics/report',
  checkAnyPermission(['view_target_analytics', 'TARGET_CYCLES_VIEW', 'SYSTEM_CONFIG']),
  targetController.getTargetReport,
);

router.get(
  '/locked-staff',
  checkAnyPermission(['unlock_target_locked_users', 'USERS_UNLOCK', 'USERS_VIEW', 'SYSTEM_CONFIG']),
  targetController.listLockedStaff,
);

router.post(
  '/unlock/:userId',
  checkAnyPermission(['unlock_target_locked_users', 'USERS_UNLOCK', 'SYSTEM_CONFIG']),
  targetController.unlockStaff,
);

router.post(
  '/grace/:userId',
  checkAnyPermission(['extend_target_grace_period', 'USERS_UNLOCK', 'SYSTEM_CONFIG']),
  targetController.extendGrace,
);

router.put(
  '/assign/:userId',
  checkAnyPermission(['assign_target_cycles', 'USERS_EDIT', 'SYSTEM_CONFIG']),
  targetController.assignUserTargetCycle,
);

router.post('/self-unlock', targetController.selfUnlock);
router.post('/self-unlock/:lockId', targetController.selfUnlock);
router.post('/target-locks/:lockId/self-unlock', targetController.selfUnlock);

export default router;
