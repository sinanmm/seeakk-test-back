import { Readable } from 'stream';
import csvParser from 'csv-parser';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { clearLeadCache } from '../../services/User/leadService';
import { resolveOrCreateLeadSourceByName } from '../master/lead-source/leadSource.service';

export const processImportJob = async (jobId: string, fileBase64: string, workspaceId: string, userId: string) => {
  const fileBuffer = Buffer.from(fileBase64, 'base64');
  
  const rows: any[] = [];
  const stream = Readable.from(fileBuffer);
  
  return new Promise<void>((resolve, reject) => {
    stream
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim().toLowerCase(),
        })
      )
      .on('data', (data) => rows.push(data))
      .on('end', async () => {
        try {
          await processRows(jobId, rows, workspaceId, userId);
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (err) => {
        logger.error(`CSV parsing error for job ${jobId}: ${err.message}`);
        reject(err);
      });
  });
};

const processRows = async (jobId: string, rows: any[], workspaceId: string, userId: string) => {
  await prisma.importJob.update({
    where: { id: jobId },
    data: { totalRows: rows.length, status: 'PROCESSING' }
  });

  let success = 0;
  let failed = 0;
  const errors: any[] = [];
  const sourceCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // The template uses headers: 'Lead Name', 'Mobile', 'Email', 'Expected Revenue', 'Source'
      // These are lowercased and end-trimmed by our mapHeaders hook
      const name = row['lead name'] || row['name'] || row['leadname'] || row['first name'] || row['contact name'];
      const phone = row['mobile'] || row['phone'] || row['contact number'] || row['cell'];
      const email = row['email'] || row['email address'];
      const expectedRevenueStr = row['expected revenue'] || row['expectedrevenue'] || row['revenue'];
      const sourceNameStr = row['source'] || row['lead source'] || row['leadsource'];

      if (!name || name.trim() === '') {
        const foundHeaders = Object.keys(row).join(', ');
        throw new Error(`Missing required field 'Name'. (We detected these columns in your file: [${foundHeaders}])`);
      }

      let sourceId: string | undefined = undefined;
      if (sourceNameStr && sourceNameStr.trim() !== '') {
        const trimmedSource = sourceNameStr.trim();
        const lowerSource = trimmedSource.toLowerCase();

        if (sourceCache.has(lowerSource)) {
          sourceId = sourceCache.get(lowerSource);
        } else {
          const sourceRecord = await resolveOrCreateLeadSourceByName(workspaceId, trimmedSource, userId);
          sourceId = sourceRecord.id;
          sourceCache.set(lowerSource, sourceRecord.id);
        }
      }

      let expectedRevenue: number | undefined = undefined;
      if (expectedRevenueStr && expectedRevenueStr.trim() !== '') {
        const parsed = parseFloat(expectedRevenueStr);
        if (!isNaN(parsed)) {
          expectedRevenue = parsed;
        }
      }

      await prisma.lead.create({
        data: {
          name: name.trim(),
          email: email ? email.trim() : null,
          phone: phone ? phone.trim() : null,
          expectedRevenue,
          sourceId: sourceId,
          workspaceId,
          createdById: userId,
        }
      });
      success++;
    } catch (err: any) {
      failed++;
      errors.push({ row: i + 2, error: err.message });
    }

    if ((i + 1) % 50 === 0) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedRows: i + 1,
          successCount: success,
          failedCount: failed
        }
      });
    }
  }

  let errorFileUrl = null;
  if (errors.length > 0) {
    errorFileUrl = JSON.stringify(errors);
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      processedRows: rows.length,
      successCount: success,
      failedCount: failed,
      status: failed === rows.length ? 'FAILED' : 'COMPLETED',
      errorFileUrl
    }
  });

  // CRITICAL: Clear cache so user sees the new leads immediately
  try {
    await clearLeadCache(workspaceId);
    logger.info(`Cleared lead cache for workspace ${workspaceId} after import job ${jobId}`);
  } catch (cacheError) {
    logger.error(`Failed to clear cache after import: ${cacheError}`);
  }

  // Add an activity log entry
  try {
    await (prisma as any).leadActivity.create({
      data: {
        leadId: (await prisma.lead.findFirst({ where: { workspaceId, createdById: userId }, orderBy: { createdAt: 'desc' } }))?.id || '',
        performedById: userId,
        workspaceId,
        action: 'IMPORT_BULK',
        metadata: {
          jobId,
          successCount: success,
          failedCount: failed,
          total: rows.length
        }
      }
    });
  } catch (activityError) {
    // Non-blocking
  }
};
