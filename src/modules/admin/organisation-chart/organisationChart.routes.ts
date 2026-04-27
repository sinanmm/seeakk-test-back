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

export default router;
