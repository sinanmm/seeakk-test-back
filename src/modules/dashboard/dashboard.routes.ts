import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as dashboardController from './dashboard.controller';

const router = Router();

router.get(
  '/summary',
  protect,
  checkAnyPermission([
    'DASHBOARD_VIEW_OWN',
    'DASHBOARD_VIEW_ASSIGNED',
    'DASHBOARD_VIEW_ALL',
    'DASHBOARD_VIEW_OWN_OFFICE',
    'DASHBOARD_VIEW_ASSIGNED_OFFICES',
    'DASHBOARD_VIEW_ALL_OFFICES',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_OWN',
    'LEADS_VIEW_TEAM',
    'SYSTEM_CONFIG',
  ]),
  dashboardController.getDashboardSummary,
);
router.get(
  '/revenue',
  protect,
  checkAnyPermission([
    'DASHBOARD_VIEW_OWN',
    'DASHBOARD_VIEW_ASSIGNED',
    'DASHBOARD_VIEW_ALL',
    'DASHBOARD_VIEW_OWN_OFFICE',
    'DASHBOARD_VIEW_ASSIGNED_OFFICES',
    'DASHBOARD_VIEW_ALL_OFFICES',
    'LEAD_APPROVAL_VIEW',
    'LEAD_APPROVAL_APPROVE',
    'LOB_ANALYSIS_VIEW',
    'VIEW_TOTAL_REVENUE',
    'VIEW_OWN_REVENUE',
  ]),
  dashboardController.getRevenueAnalytics,
);

router.get(
  '/product-analytics',
  protect,
  checkAnyPermission([
    'DASHBOARD_VIEW_OWN',
    'DASHBOARD_VIEW_ASSIGNED',
    'DASHBOARD_VIEW_ALL',
    'DASHBOARD_VIEW_OWN_OFFICE',
    'DASHBOARD_VIEW_ASSIGNED_OFFICES',
    'DASHBOARD_VIEW_ALL_OFFICES',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_OWN',
    'LEADS_VIEW_TEAM',
    'SYSTEM_CONFIG',
  ]),
  dashboardController.getProductAnalytics,
);

export default router;
