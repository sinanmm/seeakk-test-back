import { Router } from 'express';
import { protect, checkPermission } from '../../middlewares/authMiddleware';
import * as leadApprovalsController from './leadApprovals.controller';

const router = Router();

router.use(protect);

router.post('/', leadApprovalsController.createLeadApproval);
router.get('/', checkPermission('LEAD_APPROVAL_VIEW'), leadApprovalsController.listLeadApprovals);
router.patch('/:id', checkPermission('LEAD_APPROVAL_VIEW'), leadApprovalsController.handleLeadApproval);

export default router;
