import { NextFunction, Request, Response } from 'express';

import * as service from './callReports.service';
import { generateCsvString, generateExcelBuffer } from './genericExport.engine';
import { generateCallPerformanceHtmlReport, generateCallPerformancePdfReport } from './callReportExport.engine';

const getPermissions = (req: Request) => {
  const user = req.user as any;
  const userPerms: string[] = user?.permissions || [];
  const roleName = (user?.role?.name || user?.role || '').toString().toLowerCase().trim().replace(/[\s_-]+/g, '');

  const isSuperadminOrAdmin =
    roleName === 'superadmin' ||
    roleName === 'admin' ||
    userPerms.includes('CALL_REPORTS_VIEW_ALL') ||
    userPerms.includes('LEADS_VIEW_ALL') ||
    userPerms.includes('SYSTEM_CONFIG') ||
    userPerms.length === 0;

  return {
    viewAll: isSuperadminOrAdmin,
    viewAssigned: isSuperadminOrAdmin || userPerms.includes('CALL_REPORTS_VIEW_ASSIGNED') || userPerms.includes('LEADS_VIEW_ASSIGNED'),
    viewOwn: userPerms.includes('CALL_REPORTS_VIEW_OWN') || userPerms.includes('LEADS_VIEW_OWN'),
  };
};

const parseArrayQuery = (rawQuery: any): string[] | undefined => {
  if (!rawQuery) return undefined;
  if (Array.isArray(rawQuery)) {
    const list = rawQuery.map((item) => String(item).trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  const str = String(rawQuery).trim();
  if (!str) return undefined;
  const list = str.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
};

export const getCallSummaryReport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(403).json({ success: false, message: 'Forbidden: Workspace missing' });

  try {
    const permissions = getPermissions(req);
    const filters: service.CallReportFilters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      userIds: parseArrayQuery(req.query.userIds || req.query['userIds[]'] || req.query.userId),
      supervisorId: req.query.supervisorId as string,
      officeId: req.query.officeId as string,
      departmentId: req.query.departmentId as string,
      leadStageId: req.query.leadStageId as string,
      substageId: req.query.substageId as string,
      substageIds: parseArrayQuery(req.query.substageIds || req.query['substageIds[]'] || req.query.substageId),
      connectionStatus: req.query.connectionStatus as any,
      sourceContext: req.query.sourceContext as string,
    };

    const data = await service.getCallSummaryReport(workspaceId, req.user!.id, permissions, filters);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getCallDetailedReport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(403).json({ success: false, message: 'Forbidden: Workspace missing' });

  try {
    const permissions = getPermissions(req);
    const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const filters: service.CallReportFilters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      userIds: parseArrayQuery(req.query.userIds || req.query['userIds[]'] || req.query.userId),
      supervisorId: req.query.supervisorId as string,
      officeId: req.query.officeId as string,
      departmentId: req.query.departmentId as string,
      leadStageId: req.query.leadStageId as string,
      substageId: req.query.substageId as string,
      substageIds: parseArrayQuery(req.query.substageIds || req.query['substageIds[]'] || req.query.substageId),
      connectionStatus: req.query.connectionStatus as any,
      sourceContext: req.query.sourceContext as string,
      search: req.query.search as string,
      page: Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
      limit: Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100 ? parsedLimit : 20,
    };

    const data = await service.getCallDetailedReport(workspaceId, req.user!.id, permissions, filters);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const exportCallReport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(403).json({ success: false, message: 'Forbidden: Workspace missing' });

  try {
    const permissions = getPermissions(req);
    const format = (req.body.format || 'xlsx').toLowerCase();
    const rawFilters = req.body.filters || {};
    const filters: service.CallReportFilters = {
      ...rawFilters,
      userIds: parseArrayQuery(rawFilters.userIds || rawFilters['userIds[]'] || rawFilters.userId),
      substageIds: parseArrayQuery(rawFilters.substageIds || rawFilters['substageIds[]'] || rawFilters.substageId),
    };

    const summaryReport = await service.getCallSummaryReport(workspaceId, req.user!.id, permissions, filters);
    const detailedReport = await service.getCallDetailedReport(workspaceId, req.user!.id, permissions, {
      ...filters,
      limit: 5000,
    });

    const dynamicSubstages = summaryReport.selectedSubstages || [];

    const summaryColumns: Array<{ header: string; key: string; type?: 'text' | 'number' | 'percentage' | 'date' }> = [
      { header: 'User Name', key: 'userName' },
      { header: 'Office', key: 'officeName' },
      { header: 'Department', key: 'departmentName' },
      { header: 'Total Attempts', key: 'totalAttempts', type: 'number' },
      { header: 'Unique Calls', key: 'uniqueCalls', type: 'number' },
      { header: 'Connected Calls', key: 'connectedCalls', type: 'number' },
      { header: 'Not Connected', key: 'notConnectedCalls', type: 'number' },
      { header: 'Connection Rate', key: 'connectionRate', type: 'percentage' },
      ...dynamicSubstages.map((sub: any) => ({
        header: sub.parentStageName ? `${sub.name} (${sub.parentStageName})` : sub.name,
        key: `sub_${sub.id}`,
        type: 'number' as const,
      })),
      { header: 'Follow-ups Created', key: 'followUpsCreated', type: 'number' },
      { header: 'Leads Stage Moved', key: 'leadsMoved', type: 'number' },
    ];

    const formattedUserSummary = summaryReport.userSummaryList.map((u: any) => {
      const row: any = { ...u };
      dynamicSubstages.forEach((sub: any) => {
        row[`sub_${sub.id}`] = u.substageCounts?.[sub.id] || 0;
      });
      return row;
    });

    const detailedColumns: Array<{ header: string; key: string; type?: 'text' | 'number' | 'percentage' | 'date' }> = [
      { header: 'Date & Time', key: 'dateTime' },
      { header: 'User', key: 'userName' },
      { header: 'Office', key: 'officeName' },
      { header: 'Department', key: 'departmentName' },
      { header: 'Lead Name', key: 'leadName' },
      { header: 'Phone', key: 'phone' },
      { header: 'Connection Status', key: 'connectionStatus' },
      { header: 'Main Stage', key: 'mainStage' },
      { header: 'Substage', key: 'substage' },
      { header: 'Outcome Notes', key: 'outcomeNotes' },
    ];

    const detailedRows = detailedReport.rows.map((r: any) => ({
      dateTime: r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '',
      userName: r.user?.name || r.user?.email || '',
      officeName: r.user?.office?.name || 'N/A',
      departmentName: r.user?.department?.name || 'N/A',
      leadName: r.lead?.name || '',
      phone: r.lead?.phone || '',
      connectionStatus: r.connectionStatus === 'CONNECTED' ? 'Attended' : 'Not Attended',
      mainStage: r.targetStage?.name || r.substage?.leadStage?.name || '',
      substage: r.substage?.name || 'N/A',
      outcomeNotes: r.outcomeNotes || '',
    }));

    if (format === 'csv') {
      const csvStr = generateCsvString(summaryColumns, formattedUserSummary);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="call_performance_summary_${Date.now()}.csv"`);
      return res.status(200).send(csvStr);
    }

    if (format === 'html') {
      const htmlStr = generateCallPerformanceHtmlReport({
        title: 'Call Performance Analytics Report',
        workspaceName: (req.user as any)?.workspaceName || 'Seeakk Workspace',
        generatedBy: req.user?.name || req.user?.email,
        generatedAt: new Date().toLocaleString(),
        periodText: `${filters.startDate ? new Date(filters.startDate).toLocaleDateString() : 'Start'} — ${filters.endDate ? new Date(filters.endDate).toLocaleDateString() : 'End'}`,
        filtersText: `Users: ${filters.userIds ? filters.userIds.length + ' selected' : 'All Users'}`,
        metrics: summaryReport.metrics,
        selectedSubstages: summaryReport.selectedSubstages || [],
        userSummaryList: summaryReport.userSummaryList || [],
        substageBreakdown: summaryReport.substageBreakdown || [],
      });

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="Seeakk_Call_Performance_Interactive_${Date.now()}.html"`);
      return res.status(200).send(htmlStr);
    }

    if (format === 'pdf') {
      const pdfHtmlStr = generateCallPerformancePdfReport({
        title: 'Call Performance Analytics Report',
        workspaceName: (req.user as any)?.workspaceName || 'Seeakk Workspace',
        generatedBy: req.user?.name || req.user?.email,
        generatedAt: new Date().toLocaleString(),
        periodText: `${filters.startDate ? new Date(filters.startDate).toLocaleDateString() : 'Start'} — ${filters.endDate ? new Date(filters.endDate).toLocaleDateString() : 'End'}`,
        filtersText: `Users: ${filters.userIds ? filters.userIds.length + ' selected' : 'All Users'}`,
        metrics: summaryReport.metrics,
        selectedSubstages: summaryReport.selectedSubstages || [],
        userSummaryList: summaryReport.userSummaryList || [],
        substageBreakdown: summaryReport.substageBreakdown || [],
      });

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="Seeakk_Call_Performance_${Date.now()}.html"`);
      return res.status(200).send(pdfHtmlStr);
    }

    const excelBuffer = await generateExcelBuffer({
      title: 'Call Performance Analytics Report',
      workspaceName: (req.user as any)?.workspaceName || 'Seeakk Workspace',
      generatedBy: req.user?.name || req.user?.email,
      generatedAt: new Date().toLocaleString(),
      summaryMetrics: [
        { label: 'Total Call Attempts', value: summaryReport.metrics.totalCalls },
        { label: 'Unique Calls', value: summaryReport.metrics.uniqueCalls },
        { label: 'Attended Calls', value: summaryReport.metrics.connectedCalls },
        { label: 'Not Attended Calls', value: summaryReport.metrics.notConnectedCalls },
        { label: 'Connection Rate', value: `${summaryReport.metrics.connectionRate}%` },
        { label: 'Leads Stage Moved', value: summaryReport.metrics.leadsMoved },
      ],
      summaryColumns,
      summaryData: formattedUserSummary,
      detailedColumns,
      detailedData: detailedRows,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="call_performance_report_${Date.now()}.xlsx"`);
    return res.status(200).send(excelBuffer);
  } catch (error) {
    next(error);
  }
};
