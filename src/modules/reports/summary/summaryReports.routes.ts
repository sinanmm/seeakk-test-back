import { Router } from 'express';
import { protect, checkAnyPermission } from '../../../middlewares/authMiddleware';
import { getOverviewCardController, getTimelineController, getLeadsSummaryController, getFollowupsSummaryController, getExtensionsSummaryController, getStageMovementsSummaryController, getRevenueSummaryController, getAttendanceSummaryController, getTargetsSummaryController, getAuditSummaryController, getLeadUpdatesController, getApprovalsSummaryController, getCompanySummaryController } from './summaryReports.controller';

const router = Router();

router.use(protect);
router.use(checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']));

router.get('/overview-card', getOverviewCardController);
router.get('/timeline', getTimelineController);
router.get('/leads', getLeadsSummaryController);
router.get('/followups', getFollowupsSummaryController);
router.get('/extensions', getExtensionsSummaryController);
router.get('/stage-movements', getStageMovementsSummaryController);
router.get('/revenue', getRevenueSummaryController);
router.get('/attendance', getAttendanceSummaryController);
router.get('/targets', getTargetsSummaryController);
router.get('/audit', getAuditSummaryController);
router.get('/lead-updates', getLeadUpdatesController);
router.get('/approvals', getApprovalsSummaryController);
router.get('/company-summary', getCompanySummaryController);

export default router;
