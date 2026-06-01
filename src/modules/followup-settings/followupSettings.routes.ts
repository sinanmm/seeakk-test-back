import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as controller from './followupSettings.controller';

const router = Router();

router.get(
  '/',
  protect,
  checkAnyPermission(['manage_followup_settings', 'view_followup_capacity', 'bulk_extend_followups']),
  controller.getSettings,
);

router.put(
  '/',
  protect,
  checkPermission('manage_followup_settings'),
  controller.updateSettings,
);

router.get(
  '/temporary-access',
  protect,
  checkAnyPermission(['manage_followup_settings', 'grant_bulk_extension_access']),
  controller.listTemporaryAccess,
);

router.post(
  '/temporary-access',
  protect,
  checkPermission('grant_bulk_extension_access'),
  controller.grantTemporaryAccess,
);

router.delete(
  '/temporary-access/:id',
  protect,
  checkPermission('grant_bulk_extension_access'),
  controller.revokeTemporaryAccess,
);

export default router;
