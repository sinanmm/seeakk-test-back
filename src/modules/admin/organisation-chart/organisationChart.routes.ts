import { Router } from 'express';
import { checkAnyPermission, protect } from '../../../middlewares/authMiddleware';
import * as organisationChartController from './organisationChart.controller';

const router = Router();

// GET /api/admin/organisation-chart
router.get(
  '/',
  protect,
  checkAnyPermission(['USERS_VIEW', 'DEPARTMENTS_VIEW', 'SYSTEM_CONFIG']),
  organisationChartController.getOrganisationChart,
);

// GET /api/admin/organisation-chart/:userId/details
router.get(
  '/:userId/details',
  protect,
  checkAnyPermission(['USERS_VIEW', 'DEPARTMENTS_VIEW', 'SYSTEM_CONFIG']),
  organisationChartController.getUserDetails,
);

// PATCH /api/admin/organisation-chart/move
router.patch(
  '/move',
  protect,
  checkAnyPermission(['ORGANISATION_CHART_MANAGE', 'SYSTEM_CONFIG']),
  organisationChartController.moveNode,
);

export default router;
