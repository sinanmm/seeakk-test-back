import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import { requireModule } from '../../middlewares/moduleGuard';
import * as lobAnalysisController from './lobAnalysis.controller';

const router = Router();

router.use(protect);
router.use(requireModule('LOB_ANALYSIS'));

router.get(
  '/summary',
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBAnalysisSummary,
);
router.get(
  '/stage-breakdown',
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBStageBreakdown,
);
router.get(
  '/audit',
  checkAnyPermission(['LOB_ANALYSIS_VIEW', 'REPORTS_VIEW', 'SYSTEM_CONFIG']),
  lobAnalysisController.getLOBAuditTrail,
);

export default router;
