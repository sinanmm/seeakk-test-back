import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as controller from './followUpExtensionReasons.controller';

const router = Router();

const extensionReasonPickerPermissions = [
  'view_followup_extension_reasons',
  'manage_followup_extension_reasons',
  'LEADS_CREATE',
  'LEADS_EDIT',
  'LEADS_VIEW_ALL',
  'LEADS_VIEW_OWN',
  'LEADS_VIEW_TEAM',
  'SYSTEM_CONFIG',
];

router.get(
  '/',
  protect,
  checkAnyPermission(extensionReasonPickerPermissions),
  controller.listExtensionReasons,
);
router.get(
  '/active',
  protect,
  checkAnyPermission(extensionReasonPickerPermissions),
  controller.listActiveExtensionReasons,
);
router.post('/', protect, checkPermission('manage_followup_extension_reasons'), controller.createExtensionReason);
router.put('/:id', protect, checkPermission('manage_followup_extension_reasons'), controller.updateExtensionReason);
router.patch('/:id/status', protect, checkPermission('manage_followup_extension_reasons'), controller.toggleExtensionReasonStatus);
router.delete('/:id', protect, checkPermission('manage_followup_extension_reasons'), controller.deleteExtensionReason);

export default router;
