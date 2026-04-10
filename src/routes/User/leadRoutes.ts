import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as leadController from '../../controllers/User/leadController';

const router = Router();

router.use(protect);

router.get('/export', leadController.exportLeads);
router.get('/', leadController.listLeads);
router.post('/', leadController.createLead);
router.get('/:id', leadController.getLeadById);
router.put('/:id', leadController.updateLead);
router.patch('/:id/stage', leadController.changeStage);
router.patch('/:id/sla/extend', leadController.extendLeadSla);
router.patch('/:id/assign', leadController.assignLead);
router.delete('/:id/permanent', leadController.permanentlyDeleteLead);
router.delete('/:id', leadController.deleteLead);

export default router;
