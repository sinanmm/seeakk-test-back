import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as leadApprovalsController from './leadApprovals.controller';

const router = Router();

router.use(protect);

router.post('/', leadApprovalsController.createLeadApproval);
router.get('/', leadApprovalsController.listLeadApprovals);
router.patch('/:id', leadApprovalsController.handleLeadApproval);

export default router;
