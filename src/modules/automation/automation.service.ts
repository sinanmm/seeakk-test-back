import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { emitUserEvent } from '../../realtime/socket';
import { updateLead, createLead } from '../../services/User/leadService';
import { createFollowUp } from '../../services/User/followupService';
import { automationQueue } from './automation.jobs';

// ----------------------------------------------------
// 1. REGISTRIES DEFINITIONS
// ----------------------------------------------------

export const triggersRegistry = [
  { id: 'lead.created', label: 'When a lead is created', module: 'Lead' },
  { id: 'lead.stage_changed', label: 'When lead stage is changed', module: 'Lead' },
  { id: 'lead.source_changed', label: 'When lead source is changed', module: 'Lead' },
  { id: 'meta.lead_resolved', label: 'When a Meta Lead submission is resolved to a CRM lead', module: 'Lead' },
  { id: 'telephony.incoming_received', label: 'When an incoming call is received', module: 'Telephony' },
  { id: 'telephony.incoming_missed', label: 'When an incoming call is missed', module: 'Telephony' },
];

export const conditionFieldsRegistry = [
  { id: 'name', label: 'Lead Name', data_type: 'STRING' },
  { id: 'phone', label: 'Mobile', data_type: 'STRING' },
  { id: 'email', label: 'Email', data_type: 'STRING' },
  { id: 'stageId', label: 'Lead Stage', data_type: 'SELECT', options_provider: 'stages' },
  { id: 'previousStageId', label: 'Previous Stage', data_type: 'SELECT', options_provider: 'stages' },
  { id: 'newStageId', label: 'New Stage', data_type: 'SELECT', options_provider: 'stages' },
  { id: 'sourceId', label: 'Lead Source', data_type: 'SELECT', options_provider: 'sources' },
  { id: 'expectedRevenue', label: 'Expected Revenue', data_type: 'NUMBER' },
  { id: 'isClosed', label: 'Is Closed', data_type: 'BOOLEAN' },
  { id: 'isLOB', label: 'Is LOB', data_type: 'BOOLEAN' },
  { id: 'assignedToId', label: 'Assigned To', data_type: 'SELECT', options_provider: 'users' },
  { id: 'createdById', label: 'Created By', data_type: 'SELECT', options_provider: 'users' },
  { id: 'createdAt', label: 'Created Date', data_type: 'DATE' },
  { id: 'updatedAt', label: 'Updated Date', data_type: 'DATE' },
  { id: 'nextFollowUpAt', label: 'Next Follow-Up', data_type: 'DATE' },
  { id: 'lastRemark', label: 'Last Remark', data_type: 'STRING' },
  { id: 'hoursSinceLastActivity', label: 'Hours Since Last Activity', data_type: 'NUMBER' },
];

export const actionsRegistry = [
  { id: 'change_stage', label: 'Change Lead Stage', module: 'Lead' },
  { id: 'assign_user', label: 'Assign to User', module: 'Lead' },
  { id: 'create_followup', label: 'Create Follow-Up', module: 'FollowUp' },
  { id: 'add_remark', label: 'Add Remark', module: 'Lead' },
  { id: 'send_notification', label: 'Send In-App Notification', module: 'System' },
];

// ----------------------------------------------------
// 2. CONDITION EVALUATOR
// ----------------------------------------------------

export const evaluateConditionRule = (record: any, rule: any): boolean => {
  const { field, operator, value } = rule;
  const targetField = (field === 'phone' || field === 'mobile') ? 'phone' : field;
  const rawValue = record[targetField];

  if (rawValue === undefined || rawValue === null) {
    if (operator === 'Is Empty') return true;
    if (operator === 'Is Not Empty') return false;
    return false; // Deterministic null handling
  }

  const recordVal = String(rawValue).toLowerCase();
  const ruleVal = value !== undefined && value !== null ? String(value).toLowerCase() : '';

  switch (operator) {
    // Strings
    case 'Equals':
      return recordVal === ruleVal;
    case 'Does Not Equal':
      return recordVal !== ruleVal;
    case 'Contains':
      return recordVal.includes(ruleVal);
    case 'Does Not Contain':
      return !recordVal.includes(ruleVal);
    case 'Starts With':
      return recordVal.startsWith(ruleVal);
    case 'Ends With':
      return recordVal.endsWith(ruleVal);
    case 'Is Empty':
      return recordVal.trim() === '';
    case 'Is Not Empty':
      return recordVal.trim() !== '';

    // Enums / Selects
    case 'Is Any Of': {
      const choices = Array.isArray(value) ? value : String(value).split(',');
      return choices.some((c: any) => String(c).toLowerCase().trim() === recordVal);
    }
    case 'Is None Of': {
      const choices = Array.isArray(value) ? value : String(value).split(',');
      return !choices.some((c: any) => String(c).toLowerCase().trim() === recordVal);
    }

    // Numbers
    case 'Greater Than':
      return Number(rawValue) > Number(value);
    case 'Greater Than or Equal':
      return Number(rawValue) >= Number(value);
    case 'Less Than':
      return Number(rawValue) < Number(value);
    case 'Less Than or Equal':
      return Number(rawValue) <= Number(value);
    case 'Between': {
      const parts = Array.isArray(value) ? value : String(value).split(',');
      const valNum = Number(rawValue);
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      return valNum >= min && valNum <= max;
    }

    // Booleans
    case 'Is True':
      return Boolean(rawValue) === true;
    case 'Is False':
      return Boolean(rawValue) === false;

    // Dates
    case 'Before':
    case 'Is Before':
      return new Date(rawValue).getTime() < new Date(value).getTime();
    case 'After':
    case 'Is After':
      return new Date(rawValue).getTime() > new Date(value).getTime();
    case 'Is On or Before':
      return new Date(rawValue).getTime() <= new Date(value).getTime();
    case 'Is On or After':
      return new Date(rawValue).getTime() >= new Date(value).getTime();
    case 'Is Today': {
      const today = new Date();
      const d = new Date(rawValue);
      return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    }
    case 'Is Yesterday': {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const d = new Date(rawValue);
      return d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
    }
    case 'Is Tomorrow': {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const d = new Date(rawValue);
      return d.getDate() === tomorrow.getDate() && d.getMonth() === tomorrow.getMonth() && d.getFullYear() === tomorrow.getFullYear();
    }
    case 'Within Last X Days': {
      const days = Number(value);
      const diff = Date.now() - new Date(rawValue).getTime();
      return diff >= 0 && diff <= days * 86400000;
    }
    case 'Within Next X Days': {
      const days = Number(value);
      const diff = new Date(rawValue).getTime() - Date.now();
      return diff >= 0 && diff <= days * 86400000;
    }

    default:
      return false;
  }
};

export const evaluateConditionGroups = (record: any, groups: any[]): boolean => {
  if (!groups || groups.length === 0) return true; // Optional conditions match by default

  // AND inside group, OR between groups
  return groups.some((group) => {
    const rules = group.rules || [];
    if (rules.length === 0) return true;
    return rules.every((rule: any) => evaluateConditionRule(record, rule));
  });
};

// ----------------------------------------------------
// 3. VARIABLE REPLACEMENT SYSTEM
// ----------------------------------------------------

export const replaceVariables = (templateStr: string, lead: any): string => {
  if (!templateStr) return '';
  return templateStr.replace(/\{\{lead\.([a-zA-Z0-9_]+)\}\}/g, (match, fieldName) => {
    const value = lead[fieldName];
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return value.toLocaleDateString();
    return String(value);
  });
};

// ----------------------------------------------------
// 4. CORE WORKFLOW EXECUTORS
// ----------------------------------------------------

const executeActionStep = async (
  workspaceId: string,
  lead: any,
  actionType: string,
  config: any,
  actorId: string
): Promise<void> => {
  const actor = {
    id: actorId,
    email: 'system@automation.seeakk.com',
    role: 'system',
    permissions: ['LEADS_CREATE', 'LEADS_EDIT', 'LEADS_ASSIGN'],
  };

  switch (actionType) {
    case 'change_stage': {
      if (!config.stageId) throw new Error('Missing stageId in change_stage action config.');
      const { changeStage } = await import('../../services/User/leadService');
      await changeStage(workspaceId, actor as any, lead.id, {
        stageId: config.stageId,
        remarks: replaceVariables(config.remarks || 'Stage updated automatically by Workflow Automation.', lead),
        stageRuleValues: [],
      });
      break;
    }

    case 'assign_user': {
      let targetUserId: string | null = null;
      const strategy = config.strategy || 'specific';

      if (strategy === 'specific') {
        targetUserId = config.assignedToId || null;
      } else if (strategy === 'round_robin') {
        const pool = config.userIds || [];
        if (pool.length > 0) {
          let index = 0;
          try {
            const { getBullMQConnection } = await import('../../config/bullmq');
            const redis = getBullMQConnection();
            if (redis) {
              const counterKey = `workspace:${workspaceId}:workflow:roundrobin:count`;
              const count = await (redis as any).incr(counterKey);
              index = count % pool.length;
            } else {
              index = Math.floor(Math.random() * pool.length);
            }
          } catch (e) {
            index = Math.floor(Math.random() * pool.length);
          }
          targetUserId = pool[index];
        }
      } else if (strategy === 'least_assigned') {
        const pool = config.userIds || [];
        if (pool.length > 0) {
          const counts = await Promise.all(
            pool.map(async (uid: string) => {
              const count = await prisma.lead.count({
                where: {
                  assignedToId: uid,
                  isClosed: false,
                  workspaceId,
                  deletedAt: null,
                },
              });
              return { uid, count };
            })
          );
          counts.sort((a, b) => a.count - b.count);
          targetUserId = counts[0].uid;
        }
      } else if (strategy === 'random') {
        const pool = config.userIds || [];
        if (pool.length > 0) {
          const index = Math.floor(Math.random() * pool.length);
          targetUserId = pool[index];
        }
      }

      if (!targetUserId) {
        throw new Error(`Assignment strategy ${strategy} failed to resolve a target user.`);
      }

      await updateLead(workspaceId, actor as any, lead.id, {
        assignedToId: targetUserId,
      });
      break;
    }

    case 'create_followup': {
      if (!config.type || !config.delayMinutes) throw new Error('Missing type or delayMinutes in create_followup config.');
      const scheduledAt = new Date(Date.now() + Number(config.delayMinutes) * 60_000);
      await createFollowUp(workspaceId, actor as any, {
        leadId: lead.id,
        scheduledAt,
        type: config.type,
        description: replaceVariables(config.description || 'Automatic follow-up scheduled.', lead),
      });
      break;
    }

    case 'add_remark': {
      if (!config.remarks) throw new Error('Missing remarks in add_remark action config.');
      const remarkText = replaceVariables(config.remarks, lead);
      await prisma.leadRemark.create({
        data: {
          text: remarkText,
          leadId: lead.id,
          createdById: actorId,
          workspaceId,
        },
      });
      break;
    }

    case 'send_notification': {
      if (!config.recipientId || !config.message) throw new Error('Missing recipientId or message in send_notification config.');
      const msgText = replaceVariables(config.message, lead);
      const title = replaceVariables(config.title || 'Workflow Automation Alert', lead);
      
      // Broadcast real-time user notification
      emitUserEvent(config.recipientId, 'lead_updated', {
        leadId: lead.id,
        notification: {
          title,
          message: msgText,
        },
      });

      logger.info(`[Notification Action] Sent to User: ${config.recipientId} - ${title}: ${msgText}`);
      break;
    }

    default:
      throw new Error(`Unsupported action type: ${actionType}`);
  }
};

const enrichLead = async (lead: any, payload: { previousData?: any; newData?: any }) => {
  const enriched = { ...lead };

  // Calculate hoursSinceLastActivity
  try {
    const latestActivity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    const lastActivityTime = latestActivity ? latestActivity.createdAt.getTime() : lead.createdAt.getTime();
    enriched.hoursSinceLastActivity = (Date.now() - lastActivityTime) / 3600000;
  } catch (e) {
    enriched.hoursSinceLastActivity = 0;
  }

  // Calculate lastRemark
  try {
    const latestRemarkObj = await prisma.leadRemark.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    enriched.lastRemark = latestRemarkObj ? latestRemarkObj.text : (lead.remarks || '');
  } catch (e) {
    enriched.lastRemark = lead.remarks || '';
  }

  // Support previousStageId and newStageId
  enriched.previousStageId = payload.previousData?.stageId || null;
  enriched.newStageId = payload.newData?.stageId || lead.stageId;

  // Resolve user office
  if (lead.assignedToId) {
    try {
      const assignedUser = await prisma.user.findFirst({
        where: { id: lead.assignedToId },
        select: { officeId: true },
      });
      enriched.officeId = assignedUser?.officeId || null;
    } catch (e) {
      enriched.officeId = null;
    }
  } else {
    enriched.officeId = null;
  }

  return enriched;
};

// ----------------------------------------------------
// 5. WORKFLOW LIFECYCLE HANDLERS
// ----------------------------------------------------

export const executeWorkflow = async (
  executionId: string,
  payload: {
    previousData?: any;
    newData?: any;
    parentExecutionId?: string;
    executionDepth?: number;
  }
) => {
  const execution = await prisma.automationExecution.findUnique({
    where: { id: executionId },
    include: { workflow: true },
  });

  if (!execution || execution.status !== 'PENDING') return;

  const { parentExecutionId, executionDepth, previousData, newData } = payload;
  const { workspaceId, recordId, workflowSnapshot } = execution;

  logger.info(`[Automation Service] Starting execution: ${executionId} for workflow: ${execution.workflow.name}`);

  try {
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: 'RUNNING' },
    });

    // 1. Fetch latest Lead record
    const rawLead = await prisma.lead.findFirst({
      where: { id: recordId, workspaceId, deletedAt: null },
    });

    if (!rawLead) {
      await prisma.automationExecution.update({
        where: { id: executionId },
        data: {
          status: 'SKIPPED',
          error: 'Lead record no longer exists or was soft-deleted.',
        },
      });
      return;
    }

    const lead = await enrichLead(rawLead, { previousData, newData });

    // 2. Parse Snapshot Workflow Configuration
    const snap = JSON.parse(workflowSnapshot);
    const conditionGroups = JSON.parse(snap.conditionConfig || '[]');
    const actions = snap.actions || [];

    // 3. Evaluate Conditions (IF logic)
    const match = evaluateConditionGroups(lead, conditionGroups);
    if (!match) {
      logger.info(`[Automation Service] Execution: ${executionId} skipped. Conditions did not match.`);
      await prisma.automationExecution.update({
        where: { id: executionId },
        data: { status: 'SKIPPED' },
      });
      return;
    }

    if (actions.length === 0) {
      await prisma.automationExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return;
    }

    // 4. Create action executions
    const actionExecutionsData = actions.map((act: any, idx: number) => ({
      workflowExecutionId: executionId,
      actionId: act.id || `act_${idx}_${Date.now()}`,
      position: idx,
      status: 'PENDING',
      scheduledAt: new Date(Date.now() + (act.delaySeconds || 0) * 1000),
    }));

    // Create Action executions and load them back
    await prisma.$transaction(
      actionExecutionsData.map((data: any) =>
        (prisma as any).automationActionExecution.create({ data })
      )
    );

    const actionExecutions = await prisma.automationActionExecution.findMany({
      where: { workflowExecutionId: executionId },
      orderBy: { position: 'asc' },
    });

    // 5. Trigger the first action
    const firstExec = actionExecutions[0];
    const firstActionDef = actions[0];

    if (firstActionDef.delaySeconds === 0) {
      // Execute immediately
      await executeDelayedAction(executionId, firstExec.id, parentExecutionId, executionDepth);
    } else {
      // Schedule background delay using BullMQ
      await prisma.automationActionExecution.update({
        where: { id: firstExec.id },
        data: { status: 'WAITING' },
      });

      if (automationQueue) {
        await automationQueue.add(
          'execute-action',
          {
            executionId,
            actionExecutionId: firstExec.id,
            parentExecutionId,
            executionDepth,
          },
          {
            delay: firstActionDef.delaySeconds * 1000,
          }
        );
        logger.info(`[Automation Service] Action: ${firstExec.id} scheduled with delay: ${firstActionDef.delaySeconds}s`);
      }
    }
  } catch (err: any) {
    logger.error(`[Automation Service] Execution: ${executionId} failed`, { error: err.message });
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: 'FAILED',
        error: err.message,
        completedAt: new Date(),
      },
    });
  }
};

export const executeDelayedAction = async (
  executionId: string,
  actionExecutionId: string,
  parentExecutionId?: string,
  executionDepth?: number
) => {
  const actionExec = await prisma.automationActionExecution.findUnique({
    where: { id: actionExecutionId },
    include: {
      workflowExecution: {
        include: { workflow: true },
      },
    },
  });

  if (!actionExec || actionExec.status === 'COMPLETED' || actionExec.status === 'SKIPPED') return;

  const execution = actionExec.workflowExecution;
  const workspaceId = execution.workspaceId;
  const leadId = execution.recordId;

  try {
    await prisma.automationActionExecution.update({
      where: { id: actionExecutionId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });

    // 1. Fetch latest lead record (re-check state dynamically)
    const rawLead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId, deletedAt: null },
    });

    if (!rawLead) {
      await prisma.automationActionExecution.update({
        where: { id: actionExecutionId },
        data: {
          status: 'SKIPPED',
          error: 'Lead record no longer exists or was soft-deleted.',
          completedAt: new Date(),
        },
      });
      return;
    }

    const lead = await enrichLead(rawLead, {});

    // 2. Parse Snapshot Workflow action def
    const snap = JSON.parse(execution.workflowSnapshot);
    const actions = snap.actions || [];
    const actionDef = actions[actionExec.position];

    // 3. Evaluate "Run only if..." re-check condition
    let shouldRun = true;
    if (actionDef.runIfConfig) {
      try {
        const runIfGroups = JSON.parse(actionDef.runIfConfig);
        shouldRun = evaluateConditionGroups(lead, runIfGroups);
      } catch (e) {}
    }

    if (!shouldRun) {
      logger.info(`[Automation Service] Action step: ${actionExecutionId} skipped. "Run only if..." re-check was false.`);
      await prisma.automationActionExecution.update({
        where: { id: actionExecutionId },
        data: { status: 'SKIPPED', completedAt: new Date() },
      });
    } else {
      // 4. Run executor
      await executeActionStep(workspaceId, lead, actionDef.actionType, actionDef.actionConfig, execution.workflow.createdById);
      await prisma.automationActionExecution.update({
        where: { id: actionExecutionId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    // 5. Look for next action in sequence
    const nextPosition = actionExec.position + 1;
    const allExecs = await prisma.automationActionExecution.findMany({
      where: { workflowExecutionId: executionId },
      orderBy: { position: 'asc' },
    });

    const nextExec = allExecs.find((e) => e.position === nextPosition);
    if (nextExec) {
      const nextActionDef = actions[nextPosition];

      if (nextActionDef.delaySeconds === 0) {
        await executeDelayedAction(executionId, nextExec.id, parentExecutionId, executionDepth);
      } else {
        await prisma.automationActionExecution.update({
          where: { id: nextExec.id },
          data: { status: 'WAITING' },
        });

        if (automationQueue) {
          await automationQueue.add(
            'execute-action',
            {
              executionId,
              actionExecutionId: nextExec.id,
              parentExecutionId,
              executionDepth,
            },
            {
              delay: nextActionDef.delaySeconds * 1000,
            }
          );
        }
      }
    } else {
      // Final completed
      // Calculate overall workflow execution status
      const failedSteps = allExecs.filter((e) => e.status === 'FAILED');
      const finalStatus = failedSteps.length > 0 ? 'PARTIALLY_FAILED' : 'COMPLETED';
      
      await prisma.automationExecution.update({
        where: { id: executionId },
        data: { status: finalStatus, completedAt: new Date() },
      });
    }
  } catch (err: any) {
    logger.error(`[Automation Service] Delayed action execution step failed: ${actionExecutionId}`, { error: err.message });
    await prisma.automationActionExecution.update({
      where: { id: actionExecutionId },
      data: {
        status: 'FAILED',
        error: err.message,
        completedAt: new Date(),
      },
    });

    // Halting workflow chain on failure
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: 'FAILED',
        error: `Aborted workflow chain because step position ${actionExec.position} failed: ${err.message}`,
        completedAt: new Date(),
      },
    });
  }
};
