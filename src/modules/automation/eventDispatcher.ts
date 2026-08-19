import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { automationQueue } from './automation.jobs';

class EventDispatcher {
  async dispatch(
    eventType: string,
    payload: {
      workspaceId: string;
      recordId: string;
      recordType: string;
      actorId?: string;
      previousData?: any;
      newData?: any;
      parentExecutionId?: string;
      executionDepth?: number;
    }
  ) {
    const {
      workspaceId,
      recordId,
      recordType,
      parentExecutionId = null,
      executionDepth = 0,
      previousData = null,
      newData = null,
    } = payload;

    logger.info(`[Automation EventDispatcher] Event: ${eventType} received for record: ${recordId}`);

    try {
      // 1. Loop protection check
      if (executionDepth > 3) {
        logger.warn(
          `[Automation EventDispatcher] Event: ${eventType} skipped. Max execution depth (3) exceeded for parentExecutionId: ${parentExecutionId}`
        );
        return;
      }

      // 2. Query active workflows in this workspace matching the event trigger type
      const activeWorkflows = await prisma.automationWorkflow.findMany({
        where: {
          workspaceId,
          active: true,
          triggerType: eventType,
        },
        include: {
          actions: {
            orderBy: { position: 'asc' },
          },
        },
      });

      if (activeWorkflows.length === 0) {
        return;
      }

      for (const workflow of activeWorkflows) {
        // Double check: if trigger type is stage change, we can do light filtering on triggerConfig (if defined)
        let triggerConfig: any = {};
        try {
          triggerConfig = JSON.parse(workflow.triggerConfig || '{}');
        } catch (e) {}

        if (eventType === 'lead.stage_changed' && triggerConfig.stageId) {
          // Verify that new stage matches triggerConfig stageId
          if (newData?.stageId !== triggerConfig.stageId) {
            continue; // Skip if it doesn't match the specific stage we are listening for
          }
        }

        // Create unique eventId for tracking
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create the execution record
        const execution = await prisma.automationExecution.create({
          data: {
            workspaceId,
            workflowId: workflow.id,
            workflowVersion: workflow.version,
            workflowSnapshot: JSON.stringify({
              id: workflow.id,
              name: workflow.name,
              triggerType: workflow.triggerType,
              triggerConfig: workflow.triggerConfig,
              conditionConfig: workflow.conditionConfig,
              actions: workflow.actions,
            }),
            eventId,
            recordType,
            recordId,
            status: 'PENDING',
          },
        });

        // Add to background processing queue (BullMQ)
        if (automationQueue) {
          await automationQueue.add(
            `execute-${workflow.id}`,
            {
              executionId: execution.id,
              previousData,
              newData,
              parentExecutionId: execution.id,
              executionDepth: executionDepth + 1,
            },
            {
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
            }
          );
          logger.info(`[Automation EventDispatcher] Enqueued execution job: ${execution.id} for workflow: ${workflow.name}`);
        } else {
          logger.error(`[Automation EventDispatcher] BullMQ automationQueue not configured!`);
          await prisma.automationExecution.update({
            where: { id: execution.id },
            data: {
              status: 'FAILED',
              error: 'Automation queue connection unavailable.',
            },
          });
        }
      }
    } catch (error: any) {
      logger.error(`[Automation EventDispatcher] Error dispatching event: ${eventType}`, {
        message: error?.message,
        stack: error?.stack,
      });
    }
  }
}

export const eventDispatcher = new EventDispatcher();
export default eventDispatcher;
