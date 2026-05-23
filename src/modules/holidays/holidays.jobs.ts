import { Queue, Worker } from 'bullmq';
import logger from '../../utils/logger';
import { getBullMQConnection } from '../../config/bullmq';

const redisUrl = process.env.REDIS_URL?.trim();

export let holidayQueue: Queue | null = null;
export let holidayWorker: Worker | null = null;

if (redisUrl) {
  const connection = getBullMQConnection();

  holidayQueue = new Queue('holiday-queue', {
    connection: connection as any,
  });

  holidayWorker = new Worker(
    'holiday-queue',
    async (job) => {
      logger.info(`Processing job ${job.id} of type ${job.name}`);

      if (job.name === 'ai-refresh') {
        // Placeholder for AI auto-refresh if configured
      } else if (job.name === 'sla-recalculation') {
        // Placeholder to iterate all active leads and recompute SLAs based on new holidays
      }
    },
    { connection: connection as any },
  );

  holidayWorker.on('completed', (job) => {
    logger.info(`Job ${job.id} has completed!`);
  });

  holidayWorker.on('failed', (job: any, err) => {
    logger.error(`Job ${job?.id} has failed with ${err.message}`);
  });

  holidayWorker.on('error', (err) => {
    logger.error(`BullMQ Worker Error: ${err.message}`);
  });
} else {
  logger.warn('REDIS_URL not configured. Background jobs (BullMQ) for holidays are disabled.');
}
