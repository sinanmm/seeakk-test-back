import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import csvParser from 'csv-parser';
import ExcelJS from 'exceljs';
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

/**
 * Validates and parses imported follow-up date string.
 * Supports:
 * - MM/DD/YY hh:mm am/pm (e.g. 02/27/25 10:00 am)
 * - MM/DD/YYYY hh:mm am/pm (e.g. 02/27/2025 10:00 am)
 * - MM/DD/YY or MM/DD/YYYY without time
 * - ISO / standard date formats
 */
export const parseImportFollowUpDate = (inputVal: unknown): Date | null => {
  if (!inputVal) return null;
  if (inputVal instanceof Date && !isNaN(inputVal.getTime())) return inputVal;

  const str = String(inputVal).trim();
  if (!str) return null;

  // Format 1: MM/DD/YY hh:mm am/pm or MM/DD/YYYY hh:mm am/pm
  const dateTimeRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i;
  const match = str.match(dateTimeRegex);
  if (match) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    let hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = match[6] ? parseInt(match[6], 10) : 0;
    const ampm = match[7].toLowerCase();

    if (year < 100) {
      year += 2000;
    }

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hours >= 0 &&
      hours <= 23 &&
      minutes >= 0 &&
      minutes <= 59
    ) {
      const date = new Date(year, month - 1, day, hours, minutes, seconds);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Format 2: MM/DD/YY or MM/DD/YYYY without time
  const dateOnlyRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
  const dateMatch = str.match(dateOnlyRegex);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    let year = parseInt(dateMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day, 10, 0, 0);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Format 3: Standard ISO date strings
  const timestamp = Date.parse(str);
  if (!isNaN(timestamp)) {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
};

const parseRowsFromFile = async (fileBuffer: Buffer): Promise<any[]> => {
  // Check Excel zip magic bytes (0x50 0x4B)
  const isExcel = fileBuffer.length >= 4 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b;

  if (isExcel) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const rows: any[] = [];
    let headers: string[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = (row.values as any[]).slice(1);
      if (rowNumber === 1) {
        headers = values.map((v) => String(v ?? '').replace(/^\uFEFF/, '').trim().toLowerCase());
      } else {
        const rowData: Record<string, any> = {};
        headers.forEach((header, index) => {
          const val = values[index];
          let normalizedVal = val;
          if (val && typeof val === 'object') {
            if ('result' in val) normalizedVal = (val as any).result;
            else if ('text' in val) normalizedVal = (val as any).text;
            else if ('hyperlink' in val) normalizedVal = (val as any).text || (val as any).hyperlink;
            else if (val instanceof Date) normalizedVal = val.toISOString();
          }
          rowData[header] = normalizedVal;
        });
        rows.push(rowData);
      }
    });

    return rows;
  }

  const rows: any[] = [];
  const stream = Readable.from(fileBuffer);
  return new Promise<any[]>((resolve, reject) => {
    stream
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim().toLowerCase(),
        }),
      )
      .on('data', (data) => rows.push(data))
      .on('end', () => resolve(rows))
      .on('error', (err) => reject(err));
  });
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
  let rows: any[] = [];

  try {
    rows = await parseRowsFromFile(fileBuffer);
  } catch (err: any) {
    logger.error(`File parsing error for job ${jobId}: ${err.message}`);
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalRows: 0,
        processedRows: 0,
        successCount: 0,
        failedCount: 0,
        status: 'FAILED',
        errorFileUrl: JSON.stringify([{ row: 0, error: err.message || 'File parsing error.' }]),
      },
    });
    return;
  }

  await processRows(jobId, rows, workspaceId, userId);
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
    data: { totalRows: rows.length, status: 'PROCESSING' },
  });

  // Pre-fetch workspace lead stages to resolve Lead Stage column
  const workspaceStages = await prisma.leadStage.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  const stageMap = new Map<string, typeof workspaceStages[0]>();
  workspaceStages.forEach((st) => {
    stageMap.set(st.name.trim().toLowerCase(), st);
    if (st.stageShortForm) {
      stageMap.set(st.stageShortForm.trim().toLowerCase(), st);
    }
  });

  const defaultStage = workspaceStages.find((st) => !st.isLOB && !st.isClosed) || workspaceStages[0];

  // Pre-fetch user supervisor info for approval stage workflows
  const importingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, supervisorId: true },
  });
  const supervisorId = importingUser?.supervisorId || null;

  // Cache for LOB Reasons in workspace
  const lobReasonCache = new Map<string, string>();
  const activeLOBReasons = await prisma.lOBReason.findMany({
    where: { workspaceId, deletedAt: null },
  });
  activeLOBReasons.forEach((r) => {
    lobReasonCache.set(r.name.trim().toLowerCase(), r.id);
  });

  let success = 0;
  let failed = 0;
  const errors: any[] = [];
  const sourceCache = new Map<string, string>();
  let latestImportedLeadId: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
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

      // NEW columns
      const rawRemarks = row['remarks'] || row['remark'] || row['notes'] || row['note'];
      const rawNextFollowup =
        row['next followup at'] ||
        row['next follow-up at'] ||
        row['nextfollowupat'] ||
        row['next followup date'] ||
        row['followup date'] ||
        row['next followup'] ||
        row['next follow-up'];
      const rawFollowupNote =
        row['followup note'] ||
        row['follow-up note'] ||
        row['followupnote'] ||
        row['followup remarks'] ||
        row['followup description'];
      const rawLeadStage = row['lead stage'] || row['leadstage'] || row['stage'];
      const rawLOBReason = row['lob reason'] || row['lobreason'] || row['loss reason'] || row['reason'];

      const name = normalizeCell(rawName);
      const phone = normalizeCell(rawPhone);
      const email = normalizeCell(rawEmail);
      const addressStr = normalizeCell(rawAddress);
      const companyNameStr = normalizeCell(rawCompanyName);
      const expectedRevenueStr = normalizeCell(rawExpectedRevenue);
      const sourceNameStr = normalizeCell(rawSourceName);
      const remarksStr = normalizeCell(rawRemarks);
      const nextFollowupStr = normalizeCell(rawNextFollowup);
      const followupNoteStr = normalizeCell(rawFollowupNote);
      const leadStageStr = normalizeCell(rawLeadStage);
      const lobReasonStr = normalizeCell(rawLOBReason);

      const isEffectivelyEmptyRow = [
        name,
        phone,
        email,
        addressStr,
        companyNameStr,
        sourceNameStr,
        remarksStr,
        nextFollowupStr,
        leadStageStr,
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

      // 1. Validate Next Followup At date format if provided
      let parsedFollowUpDate: Date | null = null;
      if (nextFollowupStr) {
        parsedFollowUpDate = parseImportFollowUpDate(nextFollowupStr);
        if (!parsedFollowUpDate) {
          throw new Error(`Invalid Follow-up Date`);
        }
      }

      // 2. Validate Lead Stage if provided
      let targetStage = defaultStage;
      let stageWasSpecified = false;

      if (leadStageStr) {
        stageWasSpecified = true;
        const matched = stageMap.get(leadStageStr.toLowerCase());
        if (!matched) {
          throw new Error(`Lead Stage "${leadStageStr}" does not exist.`);
        }
        targetStage = matched;
      }

      // 3. Resolve or Auto-Create LOB Reason if target stage is LOB
      let resolvedLOBReasonId: string | null = null;
      if (targetStage && targetStage.isLOB) {
        if (!lobReasonStr) {
          throw new Error(`LOB Reason is required for LOB stage "${targetStage.name}".`);
        }

        const lowerReasonName = lobReasonStr.toLowerCase();
        if (lobReasonCache.has(lowerReasonName)) {
          resolvedLOBReasonId = lobReasonCache.get(lowerReasonName)!;
        } else {
          // Auto-create new LOB Reason in Master Configuration
          const createdReason = await prisma.lOBReason.create({
            data: {
              workspaceId,
              name: lobReasonStr,
              status: 'ACTIVE',
              createdById: userId,
            },
          });
          resolvedLOBReasonId = createdReason.id;
          lobReasonCache.set(lowerReasonName, createdReason.id);
        }
      }

      // 4. Resolve Lead Source
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

      let expectedRevenue: number | undefined = undefined;
      if (expectedRevenueStr) {
        const parsed = parseFloat(expectedRevenueStr);
        if (!isNaN(parsed)) {
          expectedRevenue = parsed;
        }
      }

      // 5. Determine initial stage & approval state
      const requiresApproval = stageWasSpecified && Boolean(targetStage?.isApprovalRequired);

      if (requiresApproval && !supervisorId) {
        throw new Error(
          `Supervisor Not Found. A supervisor is required to request approval for stage "${targetStage.name}".`,
        );
      }

      // If approval is required, lead remains in defaultStage until supervisor approves
      const initialStageId = requiresApproval
        ? defaultStage
          ? defaultStage.id
          : targetStage.id
        : targetStage
          ? targetStage.id
          : null;
      const initialIsLOB = requiresApproval ? false : Boolean(targetStage?.isLOB);
      const initialIsClosed = requiresApproval ? false : Boolean(targetStage?.isClosed);

      const insertData: Record<string, unknown> = {
        name: resolvedName,
        workspaceId,
        createdById: userId,
        assignedToId: userId,
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
      if (schemaState.presentColumns.has('stageid') && initialStageId) {
        insertData.stageId = initialStageId;
        insertData.stageEnteredAt = new Date();
      }
      if (schemaState.presentColumns.has('islob')) {
        insertData.isLOB = initialIsLOB;
      }
      if (schemaState.presentColumns.has('isclosed')) {
        insertData.isClosed = initialIsClosed;
      }

      const inserted = await prisma.lead.create({
        data: insertData as any,
        select: { id: true },
      });

      latestImportedLeadId = inserted.id || latestImportedLeadId;

      // 6. Handle Stage Approval Request if isApprovalRequired = true
      if (requiresApproval && supervisorId && targetStage) {
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

        await prisma.lead.update({
          where: { id: inserted.id },
          data: {
            approvalState: 'PENDING',
            pendingApprovalToStageId: targetStage.id,
            pendingApprovalRequestedAt: new Date(),
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

  try {
    await clearLeadCache(workspaceId);
    logger.info(`Cleared lead cache for workspace ${workspaceId} after import job ${jobId}`);
  } catch (cacheError) {
    logger.error(`Failed to clear cache after import: ${cacheError}`);
  }

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
  } catch {
    // Non-blocking
  }
};
