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

import { generateSummaryReportPdfReport } from './summaryExport.engine';

export const getFollowupsLatestNotesReportController = async (req: Request, res: Response) => {
  try {
    const filters = { workspaceId: req.user?.workspaceId as string, ...req.query };
    const data = await getFollowupsLatestNotesReport(filters);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const exportSummaryReportController = async (req: Request, res: Response) => {
  try {
    const rawFilters = { ...req.query, ...req.body };
    const filters = { workspaceId: req.user?.workspaceId as string, ...rawFilters };
    const summaryData = await getCompanySummary(filters);
    const userStats = summaryData.userStats || [];

    const totalRevenue = userStats.reduce((sum: number, u: any) => sum + (u.revenueGenerated || 0), 0);
    const totalLeads = userStats.reduce((sum: number, u: any) => sum + (u.leadsCreated || 0), 0);

    const pdfHtmlStr = generateSummaryReportPdfReport({
      title: 'Company-Wide Activity & Performance Report',
      workspaceName: (req.user as any)?.workspaceName || 'Seeakk Workspace',
      generatedBy: req.user?.name || req.user?.email,
      generatedAt: new Date().toLocaleString(),
      periodText: `${filters.startDate ? new Date(filters.startDate as string).toLocaleDateString() : 'Start'} — ${filters.endDate ? new Date(filters.endDate as string).toLocaleDateString() : 'End'}`,
      filtersText: `Users: ${filters.userId ? (Array.isArray(filters.userId) ? filters.userId.length + ' selected' : '1 selected') : 'All Users'}`,
      totalRevenue,
      totalLeads,
      userStats,
    });

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="Seeakk_Summary_Report_${Date.now()}.html"`);
    return res.status(200).send(pdfHtmlStr);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
