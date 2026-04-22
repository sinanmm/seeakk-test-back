import { UAParser } from 'ua-parser-js';
import requestIp from 'request-ip';
import { Request } from 'express';
import type { User } from '../types/prisma';
import prisma from '../config/prisma';

/**
 * Tracks the user's current device based on request headers.
 * Upserts device record in the Device table (creates or updates).
 */
export const trackUserDevice = async (req: Request, user: User): Promise<void> => {
  try {
    const deviceId = req.headers['x-device-id'] as string;

    if (!deviceId) return;

    const userAgent = req.headers['user-agent'] || '';
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    const os = `${result.os.name || 'Unknown OS'} ${result.os.version || ''}`.trim();
    const browser = `${result.browser.name || 'Unknown Browser'} ${result.browser.version || ''}`.trim();
    const deviceType = result.device.type || 'desktop';
    const ipAddress = requestIp.getClientIp(req) || 'Unknown IP';

    // Upsert the device - create if new, update if existing
    await prisma.device.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId: deviceId,
        },
      },
      update: {
        os,
        browser,
        deviceType,
        ipAddress,
        lastActive: new Date(),
      },
      create: {
        deviceId,
        os,
        browser,
        deviceType,
        ipAddress,
        lastActive: new Date(),
        userId: user.id,
      },
    });

    // Keep max 10 devices per user - delete the oldest if exceeded
    const devices = await prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { lastActive: 'asc' },
    });

    if (devices.length > 10) {
      const toDelete = devices.slice(0, devices.length - 10);
      await prisma.device.deleteMany({
        where: {
          id: { in: toDelete.map((d: { id: string }) => d.id) },
        },
      });
    }
  } catch (error) {
    console.error('Device tracking error:', error);
  }
};
