import { Request, Response, NextFunction } from 'express';
import { leadImportQueue } from './leadImport.jobs';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import { validateImportFile } from './leadImport.service';
import path from 'path';

export const importLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const file = req.file;
    const userId = req.user?.id;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileExtension = path.extname(file.originalname || '').toLowerCase();
    if (fileExtension !== '.csv') {
      return res.status(400).json({
        success: false,
        message: 'Only CSV files are supported for import. Export your template to .csv before upload.',
      });
    }

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User authentication required' });
    }

    const workspaceId = await resolveWorkspaceIdForUser(userId, req.user?.workspaceId);

    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace context is required' });
    }

    const job = await prisma.importJob.create({
      data: {
        workspaceId,
        fileName: file.originalname,
        createdById: userId,
        status: 'PENDING',
      },
    });

    if (leadImportQueue) {
      await leadImportQueue.add('lead-import', {
        jobId: job.id,
        file: file.buffer.toString('base64'),
        workspaceId,
        userId,
      });
    } else {
      return res.status(500).json({ success: false, message: 'Queue not configured' });
    }

    return res.status(201).json({
      success: true,
      data: {
        job_id: job.id,
        status: 'processing',
      },
    });
  } catch (error: any) {
    logger.error(`Error initiating import: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const validateImport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const file = req.file;
    const userId = req.user?.id;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User authentication required' });
    }

    const workspaceId = await resolveWorkspaceIdForUser(userId, req.user?.workspaceId);

    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace context is required' });
    }

    const fileBase64 = file.buffer.toString('base64');
    const report = await validateImportFile(fileBase64, workspaceId);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    logger.error(`Error validating import file: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to validate file' });
  }
};

export const getImportStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const jobId = req.params.jobId as string;

    const job = await prisma.importJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    let parsedDetails: any = null;
    if (job.errorFileUrl) {
      try {
        parsedDetails = JSON.parse(job.errorFileUrl);
      } catch {
        parsedDetails = null;
      }
    }

    const responseData: Record<string, any> = {
      id: job.id,
      status: job.status,
      total: job.totalRows,
      processed: job.processedRows,
      success: job.successCount,
      failed: job.failedCount,
      error_file_url: job.errorFileUrl,
    };

    if (parsedDetails && typeof parsedDetails === 'object' && parsedDetails.summary) {
      responseData.warningCount = parsedDetails.summary.warningCount || 0;
      responseData.approvalRequestsCount = parsedDetails.summary.approvalRequestsCreatedCount || 0;
      responseData.totalRevenueImported = parsedDetails.summary.totalRevenueImported || 0;
      responseData.pendingApprovalCount = parsedDetails.summary.pendingApprovalCount || 0;
      responseData.warnings = parsedDetails.warnings || [];
      responseData.approvals = parsedDetails.approvals || [];
      responseData.errors = parsedDetails.errors || [];
    }

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error: any) {
    logger.error(`Error getting job status: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
