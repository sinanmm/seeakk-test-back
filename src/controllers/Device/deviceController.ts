import { Request, Response } from "express";
import prisma from "../../config/prisma";
import logger from "../../utils/logger";
import { pushNotificationService } from "../../services/Notifications/pushNotificationService";

/**
 * Registers or updates an authenticated user's mobile device push token.
 */
export const registerPushToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const deviceId = (req.headers["x-device-id"] as string)?.trim() || req.body.deviceId?.trim();
    if (!deviceId) {
      return res.status(400).json({ message: "Device identifier (x-device-id) is required." });
    }

    const { pushToken, pushProvider = "EXPO", appVersion, os, platform, deviceName, deviceType } = req.body;

    if (!pushToken || typeof pushToken !== "string" || pushToken.trim().length === 0) {
      return res.status(422).json({ message: "Valid pushToken string is required." });
    }

    const trimmedToken = pushToken.trim();
    if (!pushNotificationService.isValidToken(trimmedToken)) {
      return res.status(422).json({ message: "Invalid push token format." });
    }

    // Invalidate any other user's device that previously held this exact token
    // to prevent cross-tenant notification leakage upon device transfer/re-assignment
    await prisma.device.updateMany({
      where: {
        pushToken: trimmedToken,
        NOT: {
          userId: user.id,
          deviceId,
        },
      },
      data: {
        pushToken: null,
        pushEnabled: false,
      },
    });

    const device = await prisma.device.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId,
        },
      },
      update: {
        pushToken: trimmedToken,
        pushProvider: pushProvider || "EXPO",
        pushEnabled: true,
        appVersion: typeof appVersion === "string" ? appVersion.trim() : undefined,
        os: typeof os === "string" ? os.trim() : (typeof platform === "string" ? platform.trim() : undefined),
        deviceType: typeof deviceType === "string" ? deviceType.trim() : (typeof deviceName === "string" ? deviceName.trim() : undefined),
        lastActive: new Date(),
      },
      create: {
        userId: user.id,
        deviceId,
        pushToken: trimmedToken,
        pushProvider: pushProvider || "EXPO",
        pushEnabled: true,
        appVersion: typeof appVersion === "string" ? appVersion.trim() : null,
        os: typeof os === "string" ? os.trim() : (typeof platform === "string" ? platform.trim() : null),
        deviceType: typeof deviceType === "string" ? deviceType.trim() : (typeof deviceName === "string" ? deviceName.trim() : "mobile"),
        lastActive: new Date(),
      },
    });

    logger.info("[DeviceController] Push token registered", {
      userId: user.id,
      workspaceId: user.workspaceId,
      deviceId,
      pushProvider: device.pushProvider,
    });

    return res.status(200).json({
      success: true,
      message: "Device push token registered successfully.",
      data: {
        deviceId: device.deviceId,
        pushEnabled: device.pushEnabled,
      },
    });
  } catch (error: any) {
    logger.error("[DeviceController] Failed to register push token", {
      error: error?.message || String(error),
    });
    return res.status(500).json({ message: "Internal server error registering push token." });
  }
};

/**
 * Unregisters a mobile device's push token on logout (idempotent).
 */
export const unregisterPushToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const deviceId = (req.headers["x-device-id"] as string)?.trim() || req.body.deviceId?.trim();
    const pushToken = typeof req.body.pushToken === "string" ? req.body.pushToken.trim() : null;

    if (deviceId) {
      await prisma.device.updateMany({
        where: {
          userId: user.id,
          deviceId,
        },
        data: {
          pushToken: null,
          pushEnabled: false,
        },
      });
    }

    if (pushToken) {
      await prisma.device.updateMany({
        where: {
          userId: user.id,
          pushToken,
        },
        data: {
          pushToken: null,
          pushEnabled: false,
        },
      });
    }

    logger.info("[DeviceController] Push token unregistered", {
      userId: user.id,
      deviceId: deviceId || "unknown",
    });

    return res.status(200).json({
      success: true,
      message: "Device push token unregistered successfully.",
    });
  } catch (error: any) {
    logger.error("[DeviceController] Failed to unregister push token", {
      error: error?.message || String(error),
    });
    return res.status(500).json({ message: "Internal server error unregistering push token." });
  }
};
