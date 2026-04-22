import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as leadStageController from './leadStage.controller';

const router = Router();

router.post('/', protect, checkPermission('LEAD_STAGES_CREATE'), leadStageController.createLeadStage);
router.get('/', protect, checkPermission('LEAD_STAGES_VIEW'), leadStageController.listLeadStages);
router.get('/pipeline', protect, checkPermission('LEAD_STAGES_VIEW'), leadStageController.getPipelineLeadStages);
router.patch('/reorder', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.reorderLeadStages);
router.put('/:id', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.updateLeadStage);
router.patch('/:id/status', protect, checkPermission('LEAD_STAGES_EDIT'), leadStageController.toggleLeadStageStatus);
router.delete('/:id', protect, checkPermission('LEAD_STAGES_DELETE'), leadStageController.deleteLeadStage);

export default router;
