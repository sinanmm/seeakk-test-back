import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as leadStageController from './leadStage.controller';

const router = Router();

router.post('/', protect, checkPermission('LEAD_STAGES_CREATE'), leadStageController.createLeadStage);
router.get(
  '/',
  protect,
  checkAnyPermission([
    'LEAD_STAGES_VIEW',
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  leadStageController.listLeadStages,
);
router.get(
  '/pipeline',
  protect,
  checkAnyPermission([
    'LEAD_STAGES_VIEW',
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  leadStageController.getPipelineLeadStages,
);
router.patch('/reorder', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.reorderLeadStages);
router.put('/:id', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.updateLeadStage);
router.patch('/:id/status', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.toggleLeadStageStatus);
router.delete('/:id', protect, checkPermission('LEAD_STAGES_DELETE'), leadStageController.deleteLeadStage);

export default router;
