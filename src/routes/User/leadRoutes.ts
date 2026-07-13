import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import { checkUserLock } from '../../middlewares/lockMiddleware';
import * as leadController from '../../controllers/User/leadController';
import { fieldHighlightController } from '../../modules/admin/field-highlights/fieldHighlights.controller';

const router = Router();

router.use(protect);

// Read-only meta used by assignee pickers — must stay available during target lock.
router.get('/meta/assignees', leadController.listLeadAssignees);

router.use(checkUserLock);

router.get('/meta/stage-rules', leadController.listLeadTransitionStageRules);
router.get('/export', leadController.exportLeads);
router.get('/', leadController.listLeads);
router.post('/', leadController.createLead);
router.get('/:id', leadController.getLeadById);
router.get('/:id/history', leadController.getLeadHistory);
router.get('/:id/remarks', leadController.getLeadRemarks);
router.get('/:id/field-edits', fieldHighlightController.getLeadEdits.bind(fieldHighlightController));
router.put('/:id', leadController.updateLead);
router.patch('/:id/star', leadController.toggleLeadStar);
router.patch('/:id/stage', leadController.changeStage);
router.patch('/:id/sla/extend', leadController.extendLeadSla);
router.patch('/:id/assign', leadController.assignLead);
router.delete('/bulk', leadController.bulkDeleteLeads);
router.delete('/:id/permanent', leadController.permanentlyDeleteLead);
router.delete('/:id', leadController.deleteLead);

export default router;
