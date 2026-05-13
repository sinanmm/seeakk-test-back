import { Queue, Worker } from 'bullmq';
import logger from '../../utils/logger';
import { processImportJob } from './leadImport.service';
import { getBullMQConnection } from '../../config/bullmq';

const redisUrl = process.env.REDIS_URL?.trim();

export let leadImportQueue: Queue | null = null;
export let leadImportWorker: Worker | null = null;

if (redisUrl) {
    const connection = getBullMQConnection();

    leadImportQueue = new Queue('lead-import', { 
        connection: connection as any
    });

    leadImportWorker = new Worker('lead-import', async (job) => {
        logger.info(`Processing lead import job ${job.id}`);
        const { jobId, file, workspaceId, userId } = job.data;
        await processImportJob(jobId, file, workspaceId, userId);
    }, { connection: connection as any });

    leadImportWorker.on('completed', (job) => {
        logger.info(`Lead import job ${job.id} has completed!`);
    });

    leadImportWorker.on('failed', (job: any, err) => {
        logger.error(`Lead import job ${job?.id} has failed with ${err.message}`);
    });

    leadImportWorker.on('error', err => {
        logger.error(`BullMQ Worker Error (lead import): ${err.message}`);
    });
} else {
    logger.warn('REDIS_URL not configured. Background jobs (BullMQ) for lead import are disabled.');
}
