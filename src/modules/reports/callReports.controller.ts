import { NextFunction, Request, Response } from 'express';

import * as service from './callReports.service';
import { generateCsvString, generateExcelBuffer } from './genericExport.engine';

const getPermissions = (req: Request) => {
  const userPerms: string[] = (req.user as any)?.permissions || [];
  return {
    viewAll: userPerms.includes('CALL_REPORTS_VIEW_ALL') || userPerms.includes('SYSTEM_CONFIG'),
    viewAssigned: userPerms.includes('CALL_REPORTS_VIEW_ASSIGNED'),
    viewOwn: userPerms.includes('CALL_REPORTS_VIEW_OWN'),
  };
};

export const getCallSummaryReport = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(403).json({ success: false, message: 'Forbidden: Workspace missing' });

  try {
    const permissions = getPermissions(req);
    const filters: service.CallReportFilters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      userIds: req.query.userIds ? String(req.query.userIds).split(',') : undefined,
      supervisorId: req.query.supervisorId as string,
      officeId: req.query.officeId as string,
      departmentId: req.query.departmentId as string,
      leadStageId: req.query.leadStageId as string,
      substageId: req.query.substageId as string,
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
    const filters: service.CallReportFilters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      userIds: req.query.userIds ? String(req.query.userIds).split(',') : undefined,
      supervisorId: req.query.supervisorId as string,
      officeId: req.query.officeId as string,
      departmentId: req.query.departmentId as string,
      leadStageId: req.query.leadStageId as string,
      substageId: req.query.substageId as string,
      connectionStatus: req.query.connectionStatus as any,
      sourceContext: req.query.sourceContext as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
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
    const filters: service.CallReportFilters = req.body.filters || {};

    const summaryReport = await service.getCallSummaryReport(workspaceId, req.user!.id, permissions, filters);
    const detailedReport = await service.getCallDetailedReport(workspaceId, req.user!.id, permissions, {
      ...filters,
      limit: 5000,
    });

    const formattedUserSummary = summaryReport.userSummaryList.map((u: any) => ({
      ...u,
      selectedSubstagesText: u.selectedSubstages
        ? u.selectedSubstages.map((s: any) => `${s.name} (${s.count})`).join(' | ')
        : 'None',
    }));

    const summaryColumns: Array<{ header: string; key: string; type?: 'text' | 'number' | 'percentage' | 'date' }> = [
      { header: 'User Name', key: 'userName' },
      { header: 'Office', key: 'officeName' },
      { header: 'Department', key: 'departmentName' },
      { header: 'Total Attempts', key: 'totalAttempts', type: 'number' },
      { header: 'Unique Calls', key: 'uniqueCalls', type: 'number' },
      { header: 'Connected Calls', key: 'connectedCalls', type: 'number' },
      { header: 'Not Connected', key: 'notConnectedCalls', type: 'number' },
      { header: 'Connection Rate', key: 'connectionRate', type: 'percentage' },
      { header: 'Selected Substages', key: 'selectedSubstagesText' },
      { header: 'Follow-ups Created', key: 'followUpsCreated', type: 'number' },
      { header: 'Leads Stage Moved', key: 'leadsMoved', type: 'number' },
    ];

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
