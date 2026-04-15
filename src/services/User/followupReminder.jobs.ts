import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import { sendFollowUpReminderEmail } from '../Email/emailService';

const isEnabled = (): boolean => process.env.FOLLOWUP_REMINDER_ENABLED === 'true';

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LEAD_TIME_MINUTES = toPositiveInt(process.env.FOLLOWUP_REMINDER_LEAD_TIME_MINUTES, 15);
const POLL_SECONDS = toPositiveInt(process.env.FOLLOWUP_REMINDER_POLL_SECONDS, 30);

const memoryDedup = new Map<string, number>();

const nowMs = () => Date.now();

const seenRecently = async (followUpId: string, ttlSeconds: number): Promise<boolean> => {
  const key = `followup:reminder:${followUpId}`;

  if (redisClient.isOpen) {
    const existing = await redisClient.get(key);
    if (existing) return true;
    await redisClient.setEx(key, ttlSeconds, '1');
    return false;
  }

  const expiresAt = memoryDedup.get(key) || 0;
  if (expiresAt > nowMs()) return true;
  memoryDedup.set(key, nowMs() + ttlSeconds * 1000);
  return false;
};

const getReminderCandidates = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + LEAD_TIME_MINUTES * 60_000);

  // Reminder policy: pending follow-ups scheduled soon (within lead time window).
  return prisma.followUp.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: {
        gte: now,
        lte: windowEnd,
      },
    },
    select: {
      id: true,
      scheduledAt: true,
      description: true,
      type: true,
      workspaceId: true,
      user: {
        select: { id: true, email: true, name: true, username: true },
      },
      lead: {
        select: { id: true, name: true },
      },
    },
    take: 200,
    orderBy: [{ scheduledAt: 'asc' }],
  });
};

const formatDisplayName = (user: { name: string | null; username: string | null; email: string }): string =>
  user.name?.trim() || user.username?.trim() || user.email;

const loopOnce = async (): Promise<void> => {
  if (!isEnabled()) return;

  const candidates = await getReminderCandidates();
  if (candidates.length === 0) return;

  for (const item of candidates) {
    try {
      // De-dupe until after scheduledAt passes (+1h), so reminders are sent once.
      const ttlSeconds = Math.max(300, Math.ceil((item.scheduledAt.getTime() - Date.now()) / 1000) + 3600);
      const alreadySent = await seenRecently(item.id, ttlSeconds);
      if (alreadySent) continue;

      await sendFollowUpReminderEmail(item.user.email, {
        userDisplayName: formatDisplayName(item.user),
        leadName: item.lead?.name || 'Lead',
        scheduledAt: item.scheduledAt,
        description: item.description || undefined,
        type: item.type,
      });

      logger.info('Follow-up reminder sent', {
        followUpId: item.id,
        userId: item.user.id,
        workspaceId: item.workspaceId,
        scheduledAt: item.scheduledAt.toISOString(),
        action: 'followup_reminder_sent',
      });
    } catch (error: any) {
      logger.error('Follow-up reminder failed', {
        followUpId: item.id,
        error: error?.message || String(error),
        action: 'followup_reminder_failed',
      });
    }
  }
};

let started = false;
export const startFollowUpReminders = (): void => {
  if (started) return;
  started = true;

  if (!isEnabled()) {
    logger.info('Follow-up reminders are disabled. Set FOLLOWUP_REMINDER_ENABLED=true to enable.', {
      action: 'followup_reminder_disabled',
    });
    return;
  }

  logger.info('Starting follow-up reminder loop', {
    leadTimeMinutes: LEAD_TIME_MINUTES,
    pollSeconds: POLL_SECONDS,
    action: 'followup_reminder_start',
  });

  const intervalMs = Math.max(10_000, POLL_SECONDS * 1000);
  // Fire quickly once after boot, then poll.
  loopOnce().catch(() => undefined);
  setInterval(() => {
    loopOnce().catch(() => undefined);
  }, intervalMs);
};

