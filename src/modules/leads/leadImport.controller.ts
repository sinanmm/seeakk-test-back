import { Request, Response, NextFunction } from 'express';
import { leadImportQueue } from './leadImport.jobs';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const importLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const file = req.file;
    const workspaceId = req.user?.workspaceId || req.body.workspaceId;
    const userId = req.user?.id;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!workspaceId || !userId) {
      return res.status(400).json({ success: false, message: 'Workspace ID and User Auth required' });
    }

    const job = await prisma.importJob.create({
      data: {
        workspaceId,
        fileName: file.originalname,
        createdById: userId,
        status: 'PENDING',
      }
    });

    if (leadImportQueue) {
      await leadImportQueue.add("lead-import", {
        jobId: job.id,
        file: file.buffer.toString('base64'),
        workspaceId,
        userId
      });
    } else {
      return res.status(500).json({ success: false, message: 'Queue not configured' });
    }

    return res.status(201).json({
      success: true,
      data: {
        job_id: job.id,
        status: "processing"
      }
    });
  } catch (error: any) {
    logger.error(`Error initiating import: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getImportStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const jobId = req.params.jobId as string;

    const job = await prisma.importJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        total: job.totalRows,
        processed: job.processedRows,
        success: job.successCount,
        failed: job.failedCount,
        error_file_url: job.errorFileUrl
      }
    });
  } catch (error: any) {
    logger.error(`Error getting job status: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
