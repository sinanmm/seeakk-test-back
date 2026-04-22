import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as organisationChartController from './organisationChart.controller';

const router = Router();

// GET /api/admin/organisation-chart
router.get(
  '/',
  protect,
  checkPermission('USERS_VIEW'),
  organisationChartController.getOrganisationChart,
);

export default router;

