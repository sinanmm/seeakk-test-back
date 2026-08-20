import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { createWorkflowSchema, updateWorkflowSchema } from './automation.validator';
import auditService from '../../services/Audit/auditService';

export const listWorkflows = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const workflows = await prisma.automationWorkflow.findMany({
      where: { workspaceId },
      include: {
        actions: { orderBy: { position: 'asc' } },
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: workflows });
  } catch (error) {
    next(error);
  }
};

export const getWorkflow = async (req: Request, res: Response, next: NextFunction) => {
  const wsId = (req.user?.workspaceId as any) as string;
  const id = req.params.id as string;

  if (!wsId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id, workspaceId: wsId },
      include: {
        actions: { orderBy: { position: 'asc' } },
      },
    });

    if (!workflow) {
      return res.status(404).json({ success: false, message: 'Workflow not found.' });
    }

    return res.status(200).json({ success: true, data: workflow });
  } catch (error) {
    next(error);
  }
};

export const createWorkflow = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const payload = createWorkflowSchema.parse(req.body);
    const actorId = req.user!.id;

    const workflow = await prisma.$transaction(async (tx) => {
      const created = await (tx as any).automationWorkflow.create({
        data: {
          workspaceId,
          name: payload.name,
          description: payload.description || null,
          triggerType: payload.triggerType,
          triggerConfig: JSON.stringify(payload.triggerConfig),
          conditionConfig: JSON.stringify(payload.conditionConfig),
          active: payload.active,
          version: 1,
          createdById: actorId,
          updatedById: actorId,
        },
      });

      if (payload.actions.length > 0) {
        await (tx as any).automationAction.createMany({
          data: payload.actions.map((act, index) => ({
            workflowId: created.id,
            position: index,
            actionType: act.actionType,
            actionConfig: JSON.stringify(act.actionConfig),
            delaySeconds: act.delaySeconds,
            runIfConfig: act.runIfConfig || null,
          })),
        });
      }

      return created;
    });

    // Audit Log
    await auditService.log({
      userId: actorId,
      workspaceId,
      action: 'AUTOMATION_WORKFLOW_CREATED',
      entityType: 'AutomationWorkflow',
      entityId: workflow.id,
      details: { name: workflow.name },
    });

    return res.status(201).json({ success: true, data: workflow });
  } catch (error) {
    next(error);
  }
};

export const updateWorkflow = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  const id = req.params.id as string;

  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const payload = updateWorkflowSchema.parse(req.body);
    const actorId = req.user!.id;

    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Workflow not found.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const up = await (tx as any).automationWorkflow.update({
        where: { id },
        data: {
          name: payload.name !== undefined ? payload.name : existing.name,
          description: payload.description !== undefined ? payload.description : existing.description,
          triggerType: payload.triggerType !== undefined ? payload.triggerType : existing.triggerType,
          triggerConfig: payload.triggerConfig !== undefined ? JSON.stringify(payload.triggerConfig) : existing.triggerConfig,
          conditionConfig: payload.conditionConfig !== undefined ? JSON.stringify(payload.conditionConfig) : existing.conditionConfig,
          active: payload.active !== undefined ? payload.active : existing.active,
          version: existing.version + 1,
          updatedById: actorId,
        },
      });

      if (payload.actions !== undefined) {
        // Drop existing actions and recreate to keep position sequence clean
        await (tx as any).automationAction.deleteMany({
          where: { workflowId: id },
        });

        if (payload.actions.length > 0) {
          await (tx as any).automationAction.createMany({
            data: payload.actions.map((act, index) => ({
              workflowId: id,
              position: index,
              actionType: act.actionType,
              actionConfig: JSON.stringify(act.actionConfig),
              delaySeconds: act.delaySeconds,
              runIfConfig: act.runIfConfig || null,
            })),
          });
        }
      }

      return up;
    });

    // Audit Log
    await auditService.log({
      userId: actorId,
      workspaceId,
      action: 'AUTOMATION_WORKFLOW_UPDATED',
      entityType: 'AutomationWorkflow',
      entityId: id,
      details: { name: updated.name, version: updated.version },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

export const deleteWorkflow = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  const id = req.params.id as string;

  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Workflow not found.' });
    }

    await prisma.automationWorkflow.delete({
      where: { id },
    });

    // Audit Log
    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: 'AUTOMATION_WORKFLOW_DELETED',
      entityType: 'AutomationWorkflow',
      entityId: id,
      details: { name: existing.name },
    });

    return res.status(200).json({ success: true, message: 'Workflow deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

export const toggleStatus = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  const id = req.params.id as string;
  const { active } = req.body;

  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Workflow not found.' });
    }

    const updated = await prisma.automationWorkflow.update({
      where: { id },
      data: { active: Boolean(active) },
    });

    // Audit Log
    await auditService.log({
      userId: req.user!.id,
      workspaceId,
      action: active ? 'AUTOMATION_WORKFLOW_ACTIVATED' : 'AUTOMATION_WORKFLOW_DEACTIVATED',
      entityType: 'AutomationWorkflow',
      entityId: id,
      details: { name: existing.name },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

export const getWorkflowRuns = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  const id = req.params.id as string;

  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const executions = await prisma.automationExecution.findMany({
      where: { workflowId: id, workspaceId },
      include: {
        actionExecutions: {
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return res.status(200).json({ success: true, data: executions });
  } catch (error) {
    next(error);
  }
};

export const getWorkflowRunDetail = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId = (req.user?.workspaceId as any) as string;
  const runId = req.params.runId as string;

  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const execution = await prisma.automationExecution.findFirst({
      where: { id: runId, workspaceId },
      include: {
        workflow: true,
        actionExecutions: {
          include: { action: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!execution) {
      return res.status(404).json({ success: false, message: 'Workflow run not found.' });
    }

    return res.status(200).json({ success: true, data: execution });
  } catch (error) {
    next(error);
  }
};

export const getAutomationMeta = async (req: Request, res: Response, next: NextFunction) => {
  const workspaceId: string = typeof req.user?.workspaceId === 'string'
    ? req.user.workspaceId
    : (Array.isArray(req.user?.workspaceId) ? req.user.workspaceId[0] : '');
  if (!workspaceId) {
    return res.status(403).json({ success: false, message: 'Forbidden: No workspace linked.' });
  }

  try {
    const [stages, sources, users, departments, offices] = await Promise.all([
      prisma.leadStage.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true } }),
      prisma.leadSource.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { workspaceId, deletedAt: null, isActive: true }, select: { id: true, name: true, email: true } }),
      prisma.department.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
      prisma.office.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    ]);

    // Format users list to fallback to email/username if name is empty
    const formattedUsers = users.map((u) => ({
      id: u.id,
      name: u.name || u.email.split('@')[0],
    }));

    return res.status(200).json({
      success: true,
      data: {
        stages,
        sources,
        users: formattedUsers,
        departments,
        offices,
      },
    });
  } catch (error) {
    next(error);
  }
};
