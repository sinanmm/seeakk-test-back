import { Queue, Worker, Job } from "bullmq";
import logger from "../../utils/logger";
import { getBullMQConnection, getBullMQPrefix } from "../../config/bullmq";
import prisma from "../../config/prisma";
import { pushNotificationService, PushMessagePayload } from "../../services/Notifications/pushNotificationService";

const redisUrl = process.env.REDIS_URL?.trim();

export interface PushNotificationJobData {
  userId: string;
  workspaceId: string;
  title: string;
  body: string;
  data: {
    type: string;
    followUpId?: string;
    leadId?: string;
    url?: string;
    [key: string]: unknown;
  };
}

export let pushNotificationQueue: Queue | null = null;
export let pushNotificationWorker: Worker | null = null;

const isTestEnv = process.env.NODE_ENV === 'test';

if (redisUrl && !isTestEnv) {
  const connection = getBullMQConnection();

  pushNotificationQueue = new Queue("push-notifications", {
    connection: connection as any,
    prefix: getBullMQPrefix(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

    pushNotificationWorker = new Worker(
    "push-notifications",
    async (job: Job<PushNotificationJobData>) => {
      const { userId, workspaceId, title, body, data } = job.data;
      logger.info("[FollowupPush] Processing push notification job", {
        jobId: job.id,
        userId,
        workspaceId,
        type: data?.type,
        followUpId: data?.followUpId,
        leadId: data?.leadId,
        channelId: "seeakk-reminders-v2",
      });

      // 1. Workspace isolation and active user verification
      const user = await prisma.user.findFirst({
        where: {
          id: userId,
          workspaceId,
          deletedAt: null,
        },
        select: { id: true, isActive: true },
      });

      if (!user) {
        logger.warn("[FollowupPush] Recipient not found or outside workspace. Delivery aborted.", {
          userId,
          workspaceId,
          jobId: job.id,
        });
        return;
      }

      if (!user.isActive) {
        logger.info("[FollowupPush] Recipient is inactive. Delivery skipped.", {
          userId,
          isActive: user.isActive,
          jobId: job.id,
        });
        return;
      }

      // 2. Query all active registered devices for this user
      const devices = await prisma.device.findMany({
        where: {
          userId: user.id,
          pushEnabled: true,
          pushToken: { not: null },
        },
        select: { id: true, deviceId: true, pushToken: true, pushProvider: true },
      });

      if (devices.length === 0) {
        logger.info("[FollowupPush] No active registered push tokens for user", {
          userId,
          jobId: job.id,
        });
        return;
      }

      // 3. Build messages for all active devices
      const messages: PushMessagePayload[] = devices
        .filter((d) => Boolean(d.pushToken))
        .map((device) => ({
          to: device.pushToken!,
          title,
          body,
          data,
          sound: "default",
          channelId: "seeakk-reminders-v2",
        }));

      // 4. Dispatch via PushNotificationService
      const result = await pushNotificationService.sendPushNotifications(messages);

      logger.info("[FollowupPush] Push dispatch completed", {
        jobId: job.id,
        userId,
        targetDeviceCount: devices.length,
        sentCount: result.sentCount,
        invalidCount: result.invalidTokens.length,
      });
    },
    {
      connection: connection as any,
      prefix: getBullMQPrefix(),
      concurrency: 5,
    },
  );

  pushNotificationWorker.on("failed", (job, err) => {
    logger.error("[Push Worker] Job failed", {
      jobId: job?.id,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });
}

/**
 * Enqueues a push notification job into the BullMQ push-notifications queue.
 */
export const enqueuePushNotification = async (
  payload: PushNotificationJobData,
): Promise<boolean> => {
  if (process.env.PUSH_NOTIFICATIONS_ENABLED === "false") {
    logger.info("[Push Queue] Push notifications globally disabled via PUSH_NOTIFICATIONS_ENABLED=false");
    return false;
  }

  if (!pushNotificationQueue) {
    logger.warn("[Push Queue] Push notification queue is not initialized (Redis not connected)");
    return false;
  }

  try {
    await pushNotificationQueue.add("send-push", payload);
    return true;
  } catch (error: any) {
    logger.error("[Push Queue] Failed to enqueue push notification", {
      error: error?.message || String(error),
      userId: payload.userId,
      workspaceId: payload.workspaceId,
    });
    return false;
  }
};
