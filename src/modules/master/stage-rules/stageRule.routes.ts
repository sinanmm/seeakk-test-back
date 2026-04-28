import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as stageRuleController from './stageRule.controller';

const router = Router();

const stageRuleReadPermissions = [
  'LEAD_STAGE_RULES_VIEW',
  'LEADS_CREATE',
  'LEADS_EDIT',
  'LEADS_VIEW_ALL',
  'LEADS_VIEW_TEAM',
  'LEADS_VIEW_OWN',
  'SYSTEM_CONFIG',
] as const;

router.post('/', protect, checkPermission('LEAD_STAGE_RULES_CREATE'), stageRuleController.createStageRule);
router.get('/', protect, checkAnyPermission([...stageRuleReadPermissions]), stageRuleController.listStageRules);
router.get('/active', protect, checkAnyPermission([...stageRuleReadPermissions]), stageRuleController.getActiveStageRules);
router.put('/:id', protect, checkPermission('LEAD_STAGE_RULES_EDIT'), stageRuleController.updateStageRule);
router.delete('/:id', protect, checkPermission('LEAD_STAGE_RULES_DELETE'), stageRuleController.deleteStageRule);

export default router;
