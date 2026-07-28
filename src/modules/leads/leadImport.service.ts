import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import csvParser from 'csv-parser';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { clearLeadCache } from '../../services/User/leadService';
import { resolveOrCreateLeadSourceByName } from '../master/lead-source/leadSource.service';
import { cleanAndParseImportedPhone } from '../../utils/phoneUtils';
import { createFollowUp } from '../../services/User/followupService';

type LeadImportSchemaState = {
  presentColumns: Set<string>;
};

const normalizeCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const normalized = String(value).replace(/\u00A0/g, ' ').trim();
  if (!normalized) return '';

  const lowered = normalized.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a' || lowered === 'na' || lowered === '-') {
    return '';
  }

  return normalized;
};

/**
 * Normalizes and parses various date formats for Next Followup At:
 * - MM/DD/YY hh:mm am/pm (e.g. 02/27/25 10:00 am)
 * - MM/DD/YYYY hh:mm AM/PM (e.g. 02/27/2025 10:00 AM)
 * - 2/27/25 10:00 am
 * - MM/DD/YYYY (e.g. 02/27/2025)
 * - ISO strings
 */
export const parseImportFollowUpDate = (rawDateStr: unknown): Date | null => {
  if (!rawDateStr) return null;
  const str = String(rawDateStr).replace(/\u00A0/g, ' ').trim();
  if (!str) return null;

  // Direct ISO/standard parse test if string contains hyphen or T
  if (str.includes('-') || str.includes('T')) {
    const directDate = new Date(str);
    if (!isNaN(directDate.getTime())) {
      return directDate;
    }
  }

  // Regex for MM/DD/YY[YY] or DD/MM/YY[YY] optionally followed by hh:mm[:ss] [am/pm]
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);

  if (match) {
    let month = parseInt(match[1], 10);
    let day = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);

    if (year < 100) {
      year += 2000;
    }

    let hours = match[4] !== undefined ? parseInt(match[4], 10) : 9;
    const minutes = match[5] !== undefined ? parseInt(match[5], 10) : 0;
    const seconds = match[6] !== undefined ? parseInt(match[6], 10) : 0;
    const ampm = match[7] ? match[7].toLowerCase() : null;

    if (ampm === 'pm' && hours < 12) {
      hours += 12;
    } else if (ampm === 'am' && hours === 12) {
      hours = 0;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day, hours, minutes, seconds);
      if (!isNaN(d.getTime())) return d;
    }
  }

  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
};

const hasMeaningfulFallbackData = (input: {
  phone: string;
  email: string;
  companyName: string;
  address: string;
}): boolean => {
  const phoneDigits = input.phone.replace(/\D/g, '');
  const hasPhone = phoneDigits.length >= 7;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email);
  const hasCompany = /[A-Za-z0-9]/.test(input.companyName) && input.companyName.length >= 2;
  void input.address;
  return hasPhone || hasEmail || hasCompany;
};

const ensureLeadImportSchemaReady = async (): Promise<LeadImportSchemaState> => {
  const leadTableRows = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  if (!leadTableRows[0]?.table_name) {
    throw new Error(
      'Lead import is not ready: table "leads" does not exist. Run `npx prisma migrate deploy` on this server DATABASE_URL, then restart the API.',
    );
  }

  const leadColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;
  const presentColumns = new Set(leadColumns.map((row) => row.column_name.toLowerCase()));
  const requiredColumns = ['name', 'workspaceId', 'createdById'] as const;
  const missingColumns = requiredColumns.filter((col) => !presentColumns.has(col.toLowerCase()));

  if (missingColumns.length > 0) {
    throw new Error(
      `Lead import is not ready: missing columns in "leads": ${missingColumns.join(', ')}. Run \`npx prisma migrate deploy\` on this server DATABASE_URL, then restart the API.`,
    );
  }

  return { presentColumns };
};

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
  let schemaState: LeadImportSchemaState;
  try {
    schemaState = await ensureLeadImportSchemaReady();
  } catch (schemaError: any) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalRows: rows.length,
        processedRows: 0,
        successCount: 0,
        failedCount: rows.length,
        status: 'FAILED',
        errorFileUrl: JSON.stringify([{ row: 0, error: schemaError?.message || 'Lead import schema check failed.' }]),
      },
    });
    return;
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { totalRows: rows.length, status: 'PROCESSING' }
  });

  logger.info('[DEBUG] Import Started', { jobId, totalRows: rows.length });

  // ------------------------------------------------------------------
  // IN-MEMORY CACHING FOR BULK IMPORT PERFORMANCE (Avoinding N+1 Queries)
  // ------------------------------------------------------------------

  // 1. Pre-cache Workspace Users
  logger.info('[DEBUG] Pre-caching Workspace Users');
  const workspaceUsers = await prisma.user.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, email: true, supervisorId: true },
  });

  const userCache = new Map<string, { id: string; supervisorId: string | null }>();
  for (const u of workspaceUsers) {
    if (u.name) {
      userCache.set(u.name.trim().toLowerCase(), { id: u.id, supervisorId: u.supervisorId });
    }
    if (u.email) {
      userCache.set(u.email.trim().toLowerCase(), { id: u.id, supervisorId: u.supervisorId });
    }
  }

  // 2. Pre-cache Lead Stages
  logger.info('[DEBUG] Pre-caching Lead Stages');
  const allStages = await prisma.leadStage.findMany({
    where: { deletedAt: null },
    orderBy: { order: 'asc' },
  });

  const stageCache = new Map<string, typeof allStages[0]>();
  const defaultStage = allStages.find((s) => s.order === 1) || allStages[0] || null;

  for (const stage of allStages) {
    stageCache.set(stage.name.trim().toLowerCase(), stage);
  }

  // 3. Pre-cache LOB Reasons
  logger.info('[DEBUG] Pre-caching LOB Reasons');
  const existingLOBReasons = await prisma.lOBReason.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true },
  });

  const lobReasonCache = new Map<string, string>();
  for (const lob of existingLOBReasons) {
    lobReasonCache.set(lob.name.trim().toLowerCase(), lob.id);
  }

  const sourceCache = new Map<string, string>();
  let success = 0;
  let failed = 0;
  const errors: any[] = [];
  let latestImportedLeadId: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // Standard & Aliased Header Extractor
      const rawName = row['lead name'] || row['name'] || row['leadname'] || row['first name'] || row['contact name'];
      const rawPhone = row['mobile'] || row['phone'] || row['contact number'] || row['cell'];
      const rawEmail = row['email'] || row['email address'];
      const rawAddress = row['adress'] || row['address'] || row['street'] || row['location'];
      const rawCompanyName =
        row['companyname'] ||
        row['company name'] ||
        row['company_name'] ||
        row['company'] ||
        row['organisation'] ||
        row['organization'];
      const rawExpectedRevenue = row['expected revenue'] || row['expectedrevenue'] || row['revenue'];
      const rawSourceName = row['source'] || row['lead source'] || row['leadsource'];

      // NEW Columns
      const rawRemarks = row['remarks'] || row['remark'] || row['notes'] || row['note'];
      const rawNextFollowUpAt =
        row['next followup at'] || row['nextfollowupat'] || row['next_followup_at'] || row['next followup'] || row['followup date'];
      const rawFollowupNote = row['followup note'] || row['followupnote'] || row['followup_note'] || row['followup remark'];
      const rawLeadStage = row['lead stage'] || row['leadstage'] || row['stage'];
      const rawLOBReason = row['lob reason'] || row['lobreason'] || row['reason'];
      const rawAssignedUser =
        row['assigned user'] || row['assigneduser'] || row['assigned to'] || row['assignedto'] || row['assignee'];

      const name = normalizeCell(rawName);
      const phone = normalizeCell(rawPhone);
      const email = normalizeCell(rawEmail);
      const addressStr = normalizeCell(rawAddress);
      const companyNameStr = normalizeCell(rawCompanyName);
      const expectedRevenueStr = normalizeCell(rawExpectedRevenue);
      const sourceNameStr = normalizeCell(rawSourceName);
      const remarksStr = normalizeCell(rawRemarks);
      const nextFollowUpAtStr = normalizeCell(rawNextFollowUpAt);
      const followupNoteStr = normalizeCell(rawFollowupNote);
      const leadStageStr = normalizeCell(rawLeadStage);
      const lobReasonStr = normalizeCell(rawLOBReason);
      const assignedUserStr = normalizeCell(rawAssignedUser);

      const isEffectivelyEmptyRow = [
        name,
        phone,
        email,
        addressStr,
        companyNameStr,
        sourceNameStr,
        remarksStr,
        nextFollowUpAtStr,
        leadStageStr,
        assignedUserStr,
      ].every((value) => !value);
      if (isEffectivelyEmptyRow) {
        continue;
      }

      let resolvedName = name;
      if (!resolvedName) {
        const hasStrongIdentifiers = hasMeaningfulFallbackData({
          phone,
          email,
          companyName: companyNameStr,
          address: addressStr,
        });
        if (!hasStrongIdentifiers) {
          continue;
        }

        resolvedName = companyNameStr || phone || email || `Imported Lead Row ${i + 2}`;
      }

      // 1. User Resolution
      let assignedToId: string | undefined = undefined;
      if (assignedUserStr) {
        logger.info(`[DEBUG] User Matching: '${assignedUserStr}'`);
        const matchedUser = userCache.get(assignedUserStr.toLowerCase());
        if (matchedUser) {
          assignedToId = matchedUser.id;
        } else {
          throw new Error(`Assigned user '${assignedUserStr}' not found.`);
        }
      } else {
        assignedToId = userId;
      }

      // 2. Lead Source Resolution
      let sourceId: string | undefined = undefined;
      if (sourceNameStr) {
        const trimmedSource = sourceNameStr;
        const lowerSource = trimmedSource.toLowerCase();

        if (sourceCache.has(lowerSource)) {
          sourceId = sourceCache.get(lowerSource);
        } else {
          const sourceRecord = await resolveOrCreateLeadSourceByName(workspaceId, trimmedSource, userId);
          sourceId = sourceRecord.id;
          sourceCache.set(lowerSource, sourceRecord.id);
        }
      }

      // 3. Lead Stage Resolution & Approval Check
      let targetStage = defaultStage;
      if (leadStageStr) {
        logger.info(`[DEBUG] Stage Matching: '${leadStageStr}'`);
        const matchedStage = stageCache.get(leadStageStr.toLowerCase());
        if (matchedStage) {
          targetStage = matchedStage;
        } else {
          throw new Error(`Lead stage '${leadStageStr}' not found.`);
        }
      }

      let requiresApproval = false;
      let supervisorId: string | null = null;
      let initialStageId = targetStage ? targetStage.id : null;
      let initialApprovalState: 'NONE' | 'PENDING' = 'NONE';
      let initialPendingApprovalToStageId: string | null = null;
      let initialIsClosed = false;
      let initialIsLOB = false;

      if (targetStage) {
        if (targetStage.isApprovalRequired) {
          requiresApproval = true;
          initialApprovalState = 'PENDING';
          initialPendingApprovalToStageId = targetStage.id;
          initialStageId = defaultStage ? defaultStage.id : targetStage.id;

          const userToLookup = assignedUserStr ? userCache.get(assignedUserStr.toLowerCase()) : null;
          supervisorId = userToLookup?.supervisorId || userCache.get(userId)?.supervisorId || null;
        } else {
          initialStageId = targetStage.id;
          initialIsClosed = targetStage.isClosed;
          initialIsLOB = targetStage.isLOB;
        }
      }

      // 4. LOB Reason Resolution & Auto Creation
      let resolvedLOBReasonId: string | null = null;
      if (lobReasonStr) {
        logger.info(`[DEBUG] LOB Matching: '${lobReasonStr}'`);
        const lowerLOB = lobReasonStr.toLowerCase();
        if (lobReasonCache.has(lowerLOB)) {
          resolvedLOBReasonId = lobReasonCache.get(lowerLOB)!;
        } else {
          logger.info(`[DEBUG] LOB Reason Created: '${lobReasonStr}'`);
          const newLOB = await prisma.lOBReason.create({
            data: {
              workspaceId,
              name: lobReasonStr,
              status: 'ACTIVE',
              createdById: userId,
            },
          });
          resolvedLOBReasonId = newLOB.id;
          lobReasonCache.set(lowerLOB, newLOB.id);
        }
      }

      // 5. Next Followup Date Parsing
      let parsedFollowUpDate: Date | null = null;
      if (nextFollowUpAtStr) {
        parsedFollowUpDate = parseImportFollowUpDate(nextFollowUpAtStr);
        if (!parsedFollowUpDate) {
          throw new Error(
            `Invalid Next Followup At date format: '${nextFollowUpAtStr}'. Expected format: MM/DD/YY hh:mm am/pm.`,
          );
        }
      }

      let expectedRevenue: number | undefined = undefined;
      if (expectedRevenueStr) {
        const parsed = parseFloat(expectedRevenueStr);
        if (!isNaN(parsed)) {
          expectedRevenue = parsed;
        }
      }

      const insertData: Record<string, unknown> = {
        name: resolvedName,
        workspaceId,
        createdById: userId,
      };

      if (schemaState.presentColumns.has('id')) {
        insertData.id = randomUUID();
      }
      if (schemaState.presentColumns.has('createdat')) {
        insertData.createdAt = new Date();
      }
      if (schemaState.presentColumns.has('updatedat')) {
        insertData.updatedAt = new Date();
      }

      if (schemaState.presentColumns.has('email')) {
        insertData.email = email || null;
      }
      if (schemaState.presentColumns.has('phone')) {
        insertData.phone = phone ? cleanAndParseImportedPhone(phone) : null;
      }
      if (schemaState.presentColumns.has('companyname')) {
        insertData.companyName = companyNameStr || null;
      }
      if (schemaState.presentColumns.has('address')) {
        insertData.address = addressStr || null;
      }
      if (schemaState.presentColumns.has('remarks')) {
        insertData.remarks = remarksStr || null;
      }
      if (schemaState.presentColumns.has('expectedrevenue')) {
        insertData.expectedRevenue = expectedRevenue ?? null;
      }
      if (schemaState.presentColumns.has('sourceid')) {
        insertData.sourceId = sourceId ?? null;
      }
      if (schemaState.presentColumns.has('assignedtoid')) {
        insertData.assignedToId = assignedToId ?? null;
      }
      if (schemaState.presentColumns.has('stageid')) {
        insertData.stageId = initialStageId ?? null;
      }
      if (schemaState.presentColumns.has('approvalstate')) {
        insertData.approvalState = initialApprovalState;
      }
      if (schemaState.presentColumns.has('pendingapprovaltostageid')) {
        insertData.pendingApprovalToStageId = initialPendingApprovalToStageId;
      }
      if (schemaState.presentColumns.has('pendingapprovalrequestedat')) {
        insertData.pendingApprovalRequestedAt = requiresApproval ? new Date() : null;
      }
      if (schemaState.presentColumns.has('stageenteredat')) {
        insertData.stageEnteredAt = new Date();
      }
      if (schemaState.presentColumns.has('islob')) {
        insertData.isLOB = initialIsLOB;
      }
      if (schemaState.presentColumns.has('isclosed')) {
        insertData.isClosed = initialIsClosed;
      }
      if (schemaState.presentColumns.has('nextfollowupat') && parsedFollowUpDate) {
        insertData.nextFollowUpAt = parsedFollowUpDate;
      }

      const inserted = await prisma.lead.create({
        data: insertData as any,
        select: { id: true },
      });

      latestImportedLeadId = inserted.id || latestImportedLeadId;

      // 6. Handle Stage Approval Request if isApprovalRequired = true
      if (requiresApproval && targetStage) {
        logger.info(`[DEBUG] Approval Triggered for lead ${inserted.id} to stage ${targetStage.name}`);
        await (prisma as any).leadStageApproval.create({
          data: {
            workspaceId,
            leadId: inserted.id,
            fromStageId: defaultStage ? defaultStage.id : targetStage.id,
            toStageId: targetStage.id,
            requestedById: userId,
            assignedToId: supervisorId,
            status: 'PENDING',
            requestData: targetStage.isLOB && resolvedLOBReasonId ? { reasonId: resolvedLOBReasonId } : {},
          },
        });

        try {
          await (prisma as any).leadActivity.create({
            data: {
              leadId: inserted.id,
              performedById: userId,
              workspaceId,
              action: 'STAGE_APPROVAL_REQUESTED',
              metadata: {
                fromStageId: defaultStage ? defaultStage.id : targetStage.id,
                toStageId: targetStage.id,
                assignedToId: supervisorId,
              },
            },
          });
        } catch {
          // Non-blocking
        }
      } else if (!requiresApproval && targetStage?.isLOB && resolvedLOBReasonId) {
        // Create LeadLOBLog for direct LOB stage import
        try {
          await prisma.leadLOBLog.create({
            data: {
              leadId: inserted.id,
              reasonId: resolvedLOBReasonId,
              remarks: remarksStr || null,
              changedById: userId,
              workspaceId,
              previousStageId: defaultStage ? defaultStage.id : null,
              previousStageName: defaultStage ? defaultStage.name : null,
            },
          });
        } catch {
          // Non-blocking
        }
      }

      // 7. Create Follow-up using existing Follow-up Service
      if (parsedFollowUpDate) {
        try {
          await createFollowUp(
            workspaceId,
            { id: userId },
            {
              leadId: inserted.id,
              type: 'CALL',
              scheduledAt: parsedFollowUpDate,
              description: followupNoteStr || undefined,
            },
          );
          logger.info(`[DEBUG] Follow-up Created for lead ${inserted.id} scheduled at ${parsedFollowUpDate.toISOString()}`);
        } catch (followupErr: any) {
          logger.warn(
            `Follow-up creation warning during import for lead ${inserted.id}: ${followupErr?.message || followupErr}`,
          );
          // Fallback: set nextFollowUpAt directly on lead record if follow-up service encounters secondary constraints
          await prisma.lead.update({
            where: { id: inserted.id },
            data: { nextFollowUpAt: parsedFollowUpDate },
          });
        }
      }

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
          failedCount: failed,
        },
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
      errorFileUrl,
    },
  });

  logger.info('[DEBUG] Import Completed', { jobId, totalRows: rows.length, success, failed });

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
        leadId: latestImportedLeadId || '',
        performedById: userId,
        workspaceId,
        action: 'IMPORT_BULK',
        metadata: {
          jobId,
          successCount: success,
          failedCount: failed,
          total: rows.length,
        },
      },
    });
  } catch (activityError) {
    // Non-blocking
  }
};
