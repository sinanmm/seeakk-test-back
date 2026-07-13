import { PrismaClient } from '@prisma/client';

export function buildLeadChangesToTrack(existing: any, input: any, existingDynamicValues: any[] = []) {
  const changes: Array<{ fieldKey: string; oldValue: any; newValue: any }> = [];
  
  const track = (key: string, oldVal: any, newVal: any) => {
    if (newVal !== undefined && oldVal !== newVal) {
      changes.push({ fieldKey: key, oldValue: oldVal, newValue: newVal });
    }
  };

  track('name', existing.name, input.name?.trim());
  track('email', existing.email, input.email?.trim());
  track('phone', existing.phone, input.phone?.trim());
  track('companyName', existing.companyName, input.companyName === null ? null : input.companyName?.trim());
  track('address', existing.address, input.address === null ? null : input.address?.trim());
  track('remarks', existing.remarks, input.remarks);
  track('expectedRevenue', existing.expectedRevenue, input.expectedRevenue);
  track('assignedToId', existing.assignedToId, input.assignedToId);
  track('stageId', existing.stageId, input.stageId);
  track('sourceId', existing.sourceId, input.sourceId);
  track('nextFollowUpAt', existing.nextFollowUpAt?.toISOString(), input.nextFollowUpAt?.toISOString());
  track('isClosed', existing.isClosed, input.isClosed);
  
  if (input.totalAmount !== undefined) track('totalAmount', existing.totalAmount, input.totalAmount);
  
  if (input.dynamicValues) {
    const existingDynamicMap = new Map(existingDynamicValues.map(v => [v.fieldId, v.value]));
    for (const dv of input.dynamicValues) {
       const oldVal = existingDynamicMap.get(dv.fieldId);
       if (oldVal !== dv.value) {
          changes.push({ fieldKey: dv.fieldId, oldValue: oldVal, newValue: dv.value });
       }
    }
  }

  return changes;
}

export async function trackFieldEdits(
  tx: any, // Prisma transaction client
  workspaceId: string,
  leadId: string,
  userId: string,
  changes: Array<{ fieldKey: string; oldValue: any; newValue: any }>,
  reason?: string
) {
  if (changes.length === 0) return;

  const configs = await tx.fieldHighlightConfig.findMany({
    where: { workspaceId, isEnabled: true },
    select: { fieldKey: true }
  });

  const enabledKeys = new Set(configs.map((c: any) => c.fieldKey));

  for (const change of changes) {
    if (!enabledKeys.has(change.fieldKey)) continue;

    const oldStr = change.oldValue === null || change.oldValue === undefined ? null : String(change.oldValue).trim();
    const newStr = change.newValue === null || change.newValue === undefined ? null : String(change.newValue).trim();

    if (oldStr === newStr) continue;

    const summary = await tx.leadFieldEditSummary.upsert({
      where: {
        leadId_fieldKey: {
          leadId,
          fieldKey: change.fieldKey
        }
      },
      update: {
        editCount: { increment: 1 }
      },
      create: {
        leadId,
        fieldKey: change.fieldKey,
        editCount: 1
      }
    });

    await tx.leadFieldEditHistory.create({
      data: {
        leadId,
        fieldKey: change.fieldKey,
        oldValue: oldStr,
        newValue: newStr,
        changedById: userId,
        editNumber: summary.editCount,
        reason: reason || null
      }
    });
  }
}
