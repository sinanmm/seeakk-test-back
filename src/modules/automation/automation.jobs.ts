import { Queue, Worker } from 'bullmq';
import logger from '../../utils/logger';
import { getBullMQConnection } from '../../config/bullmq';
import * as automationService from './automation.service';

const redisUrl = process.env.REDIS_URL?.trim();

export let automationQueue: Queue | null = null;
export let automationWorker: Worker | null = null;

if (redisUrl) {
  const connection = getBullMQConnection();

  automationQueue = new Queue('automation-engine', {
    connection: connection as any,
  });

  automationWorker = new Worker(
    'automation-engine',
    async (job) => {
      const jobName = job.name;
      logger.info(`[Automation Worker] Processing job: ${job.id} (name: ${jobName})`);

      try {
        if (jobName.startsWith('execute-')) {
          // 1. Core Workflow Execution Trigger
          const { executionId, previousData, newData, parentExecutionId, executionDepth } = job.data;
          await automationService.executeWorkflow(executionId, {
            previousData,
            newData,
            parentExecutionId,
            executionDepth,
          });
        } else if (jobName === 'execute-action') {
          // 2. Delayed Action Execution Trigger
          const { executionId, actionExecutionId, parentExecutionId, executionDepth } = job.data;
          await automationService.executeDelayedAction(
            executionId,
            actionExecutionId,
            parentExecutionId,
            executionDepth
          );
        }
      } catch (err: any) {
        logger.error(`[Automation Worker] Failed job: ${job.id}`, { error: err.message });
        throw err;
      }
    },
    { connection: connection as any }
  );

  automationWorker.on('completed', (job) => {
    logger.info(`[Automation Worker] Job ${job.id} has completed successfully.`);
  });

  automationWorker.on('failed', (job: any, err) => {
    logger.error(`[Automation Worker] Job ${job?.id} has failed with: ${err.message}`);
  });

  automationWorker.on('error', (err) => {
    logger.error(`[Automation Worker] BullMQ worker connection error: ${err.message}`);
  });
} else {
  logger.warn('REDIS_URL not configured. Background jobs (BullMQ) for automation-engine are disabled.');
}
