import { Queue, Worker } from 'bullmq';
import * as holidaySyncService from './holidays.sync';
import logger from '../../utils/logger';
import prisma from '../../config/prisma';
import { getBullMQConnection } from '../../config/bullmq';

const redisUrl = process.env.REDIS_URL?.trim();

export let holidayQueue: Queue | null = null;
export let holidayWorker: Worker | null = null;

if (redisUrl) {
    const connection = getBullMQConnection();

    holidayQueue = new Queue('holiday-queue', { 
        connection: connection as any
    });

    holidayWorker = new Worker('holiday-queue', async (job) => {
        logger.info(`Processing job ${job.id} of type ${job.name}`);
        
        if (job.name === 'daily-sync') {
            const workspaces = await prisma.workspace.findMany();
            for (const ws of workspaces) {
                try {
                    await holidaySyncService.syncGoogleHolidays(ws.id, null);
                } catch (err: any) {
                    logger.error(`Failed to sync holidays for workspace ${ws.id}: ${err.message}`);
                }
            }
        } else if (job.name === 'ai-refresh') {
            // Placeholder for AI auto-refresh if configured
        } else if (job.name === 'sla-recalculation') {
            // Placeholder to iterate all active leads and recompute SLAs based on new holidays
        }
    }, { connection: connection as any });

    holidayWorker.on('completed', (job) => {
        logger.info(`Job ${job.id} has completed!`);
    });

    holidayWorker.on('failed', (job: any, err) => {
        logger.error(`Job ${job?.id} has failed with ${err.message}`);
    });

    // Handle internal bullmq errors so they don't crash
    holidayWorker.on('error', err => {
        logger.error(`BullMQ Worker Error: ${err.message}`);
    });
} else {
    logger.warn('REDIS_URL not configured. Background jobs (BullMQ) for holidays are disabled.');
}

export const scheduleDailySync = async () => {
    if (!holidayQueue) {
        logger.warn('Cannot schedule daily sync: Redis/BullMQ is disabled.');
        return;
    }
    await holidayQueue.add('daily-sync', {}, {
        repeat: { pattern: '0 0 * * *' } // Every day at midnight
    });
};
