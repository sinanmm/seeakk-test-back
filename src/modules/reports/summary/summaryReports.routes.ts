import { Router } from 'express';
import { protect, checkAnyPermission } from '../../../middlewares/authMiddleware';
import { getOverviewCardController, getTimelineController, getLeadsSummaryController, getFollowupsSummaryController, getExtensionsSummaryController, getStageMovementsSummaryController, getRevenueSummaryController, getAttendanceSummaryController, getTargetsSummaryController, getAuditSummaryController, getLeadUpdatesController, getApprovalsSummaryController, getCompanySummaryController, getFollowupsDetailReportController, getFollowupsPerformanceReportController, getFollowupsLatestNotesReportController, exportSummaryReportController } from './summaryReports.controller';

const router = Router();

router.use(protect);
router.use(checkAnyPermission(['REPORTS_VIEW', 'REPORTS_GENERATE']));

router.get('/overview-card', getOverviewCardController);
router.get('/timeline', getTimelineController);
router.get('/leads', getLeadsSummaryController);
router.get('/followups', getFollowupsSummaryController);
router.get('/followups/detail', getFollowupsDetailReportController);
router.get('/followups/performance', getFollowupsPerformanceReportController);
router.get('/followups/latest-notes', getFollowupsLatestNotesReportController);
router.get('/extensions', getExtensionsSummaryController);
router.get('/stage-movements', getStageMovementsSummaryController);
router.get('/revenue', getRevenueSummaryController);
router.get('/attendance', getAttendanceSummaryController);
router.get('/targets', getTargetsSummaryController);
router.get('/audit', getAuditSummaryController);
router.get('/lead-updates', getLeadUpdatesController);
router.get('/approvals', getApprovalsSummaryController);
router.get('/company-summary', getCompanySummaryController);
router.get('/export', exportSummaryReportController);
router.post('/export', exportSummaryReportController);

export default router;
