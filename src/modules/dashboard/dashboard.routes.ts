import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as dashboardController from './dashboard.controller';

const router = Router();

router.get('/summary', protect, dashboardController.getDashboardSummary);
router.get(
  '/revenue',
  protect,
  checkAnyPermission(['LEAD_APPROVAL_VIEW', 'LEAD_APPROVAL_APPROVE', 'LOB_ANALYSIS_VIEW']),
  dashboardController.getRevenueAnalytics,
);

export default router;
