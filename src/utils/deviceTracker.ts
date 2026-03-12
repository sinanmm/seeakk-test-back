import { UAParser } from 'ua-parser-js';
import requestIp from 'request-ip';
import { Request } from 'express';
import { IUser } from '../models/Auth/user';

export const trackUserDevice = async (req: Request, user: IUser): Promise<void> => {
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

    const existingDeviceIndex = user.devices.findIndex((d) => d.deviceId === deviceId);

    if (existingDeviceIndex > -1) {
      user.devices[existingDeviceIndex].lastActive = new Date();
      user.devices[existingDeviceIndex].ipAddress = ipAddress;
      user.devices[existingDeviceIndex].os = os;
      user.devices[existingDeviceIndex].browser = browser;
      user.devices[existingDeviceIndex].deviceType = deviceType;
    } else {
      if (user.devices.length >= 10) {
        user.devices.sort((a, b) => a.lastActive.getTime() - b.lastActive.getTime());
        user.devices.shift();
      }

      user.devices.push({
        deviceId,
        os,
        browser,
        deviceType,
        ipAddress,
        lastActive: new Date(),
      });
    }

    await user.save();
  } catch (error) {
    console.error('Device tracking layer error:', error);
  }
};
