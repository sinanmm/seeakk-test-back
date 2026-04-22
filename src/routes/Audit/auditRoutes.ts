import { Router } from 'express';
import * as auditController from '../../controllers/Audit/auditController';
import { protect, authorize } from '../../middlewares/authMiddleware';

const router = Router();

// Only Admins can view audit logs of their workspace
router.get('/logs', protect, authorize('admin'), auditController.getAuditLogs);

export default router;
