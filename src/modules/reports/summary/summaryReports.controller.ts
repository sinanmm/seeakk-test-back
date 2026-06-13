import { Request, Response } from 'express';
import { getOverviewCard, getTimeline, getLeadsSummary, getFollowupsSummary, getExtensionsSummary, getStageMovementsSummary, getRevenueSummary, getAttendanceSummary, getTargetsSummary, getAuditSummary, getLeadUpdates, getApprovalsSummary, getCompanySummary } from './summaryReports.service';
import {
  getFollowupsDetailReport,
  getFollowupsLatestNotesReport,
  getFollowupsPerformanceReport,
} from './followupNotesReports.service';

export const getOverviewCardController = async (req: Request, res: Response) => {
  try {
    const filters = {
      workspaceId: req.user?.workspaceId as string,
      ...req.query,
    };
    const data = await getOverviewCard(filters);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTimelineController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getTimeline(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getLeadsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getLeadsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFollowupsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getFollowupsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getExtensionsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getExtensionsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getStageMovementsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getStageMovementsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRevenueSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getRevenueSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttendanceSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getAttendanceSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTargetsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getTargetsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAuditSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getAuditSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getLeadUpdatesController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getLeadUpdates(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getApprovalsSummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getApprovalsSummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCompanySummaryController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getCompanySummary(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFollowupsDetailReportController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    res.json({ success: true, ...(await getFollowupsDetailReport(filters)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFollowupsPerformanceReportController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    const data = await getFollowupsPerformanceReport(filters);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFollowupsLatestNotesReportController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    const data = await getFollowupsLatestNotesReport(filters);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
