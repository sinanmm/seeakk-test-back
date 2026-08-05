import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as controller from './substage.controller';

const router = Router();

router.use(protect);

router.get(
  '/',
  checkAnyPermission([
    'LEAD_SUBSTAGES_VIEW',
    'LEAD_STAGES_VIEW',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  controller.listSubstages,
);

router.get(
  '/grouped',
  checkAnyPermission([
    'LEAD_SUBSTAGES_VIEW',
    'LEAD_SUBSTAGES_USE',
    'LEAD_STAGES_VIEW',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  controller.getSubstagesGrouped,
);

router.post('/', checkPermission('LEAD_SUBSTAGES_CREATE'), controller.createSubstage);
router.put('/:id', checkPermission('LEAD_SUBSTAGES_EDIT'), controller.updateSubstage);
router.patch('/:id/status', checkPermission('LEAD_SUBSTAGES_TOGGLE'), controller.toggleSubstageStatus);
router.delete('/:id', checkPermission('LEAD_SUBSTAGES_DELETE'), controller.deleteSubstage);

export default router;
