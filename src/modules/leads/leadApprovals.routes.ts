import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as leadApprovalsController from './leadApprovals.controller';

const router = Router();

router.use(protect);

router.post('/', leadApprovalsController.createLeadApproval);
router.get(
  '/',
  checkAnyPermission(['LEAD_APPROVAL_VIEW', 'LEAD_APPROVAL_APPROVE', 'LEAD_APPROVAL_DENY', 'LEADS_APPROVE', 'LEADS_REJECT']),
  leadApprovalsController.listLeadApprovals,
);
router.patch(
  '/:id',
  checkAnyPermission(['LEAD_APPROVAL_APPROVE', 'LEAD_APPROVAL_DENY', 'LEADS_APPROVE', 'LEADS_REJECT']),
  leadApprovalsController.handleLeadApproval,
);

export default router;
