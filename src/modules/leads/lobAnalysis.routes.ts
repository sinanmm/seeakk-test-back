import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as lobAnalysisController from './lobAnalysis.controller';

const router = Router();

router.get(
  '/summary',
  protect,
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBAnalysisSummary,
);
router.get(
  '/stage-breakdown',
  protect,
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBStageBreakdown,
);
router.get(
  '/audit',
  protect,
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBAuditTrail,
);

export default router;
