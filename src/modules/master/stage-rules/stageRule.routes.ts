import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as stageRuleController from './stageRule.controller';

const router = Router();

router.post('/', protect, checkPermission('LEAD_STAGE_RULES_CREATE'), stageRuleController.createStageRule);
router.get('/', protect, checkPermission('LEAD_STAGE_RULES_VIEW'), stageRuleController.listStageRules);
router.get('/active', protect, checkPermission('LEAD_STAGE_RULES_VIEW'), stageRuleController.getActiveStageRules);
router.put('/:id', protect, checkPermission('LEAD_STAGE_RULES_EDIT'), stageRuleController.updateStageRule);
router.delete('/:id', protect, checkPermission('LEAD_STAGE_RULES_DELETE'), stageRuleController.deleteStageRule);

export default router;
