import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import * as dashboardController from './dashboard.controller';

const router = Router();

router.get('/summary', protect, dashboardController.getDashboardSummary);

export default router;
