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

/**
 * Controlled diagnostic endpoint to test ONE specific follow-up reminder push notification
 * end-to-end for the authenticated user and their active registered devices.
 */
export const testFollowupPush = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user;
    if (!user?.id || !user?.workspaceId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { followUpId } = req.params;
    if (!followUpId || typeof followUpId !== "string" || followUpId.trim().length === 0) {
      return res.status(400).json({ message: "followUpId parameter is required." });
    }

    const followUp = await prisma.followUp.findFirst({
      where: {
        id: followUpId.trim(),
        workspaceId: user.workspaceId,
      },
      include: {
        lead: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!followUp) {
      return res.status(404).json({ message: "Follow-up not found within user workspace." });
    }

    // Authorization: User must be assigned to the follow-up or be a workspace superadmin/admin
    const isOwner = followUp.userId === user.id;
    const isSuperAdmin = user.role?.name?.toLowerCase().trim() === "superadmin";
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ message: "Not authorized to trigger test notification for this follow-up." });
    }

    const devices = await prisma.device.findMany({
      where: {
        userId: followUp.userId,
        pushEnabled: true,
        pushToken: { not: null },
      },
      select: {
        id: true,
        deviceId: true,
        os: true,
        pushToken: true,
        pushProvider: true,
      },
    });

    if (devices.length === 0) {
      return res.status(200).json({
        success: false,
        message: "No active push-enabled devices registered for the follow-up recipient.",
        diagnostic: {
          followUpId: followUp.id,
          recipientUserId: followUp.userId,
          deviceCount: 0,
        },
      });
    }

    const leadName = followUp.lead?.name || "Lead";
    const timeStr = followUp.scheduledAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const typeStr = followUp.type || "Follow-up";

    const messages = devices
      .filter((d) => Boolean(d.pushToken))
      .map((d) => ({
        to: d.pushToken!,
        title: `Follow-up Reminder: ${leadName}`,
        body: `${typeStr} scheduled for ${timeStr}`,
        data: {
          type: "FOLLOWUP_REMINDER",
          followUpId: followUp.id,
          leadId: followUp.lead?.id,
          url: followUp.lead?.id ? `/(protected)/leads/${followUp.lead.id}` : "/(protected)/(tabs)/followups",
          isDiagnosticTest: true,
        },
        sound: "default" as const,
        channelId: "seeakk-reminders-v2",
      }));

    logger.info("[FollowupPush] Test diagnostic dispatch initiated", {
      followUpId: followUp.id,
      userId: followUp.userId,
      workspaceId: user.workspaceId,
      deviceCount: devices.length,
      channelId: "seeakk-reminders-v2",
    });

    const result = await pushNotificationService.sendPushNotifications(messages);

    return res.status(200).json({
      success: true,
      message: "Follow-up push notification test dispatched successfully.",
      diagnostic: {
        followUpId: followUp.id,
        workspaceId: user.workspaceId,
        recipientUserId: followUp.userId,
        targetDeviceCount: devices.length,
        channelId: "seeakk-reminders-v2",
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          os: d.os,
          tokenSuffix: d.pushToken ? `...${d.pushToken.slice(-6)}` : null,
          pushProvider: d.pushProvider,
        })),
        sentCount: result.sentCount,
        invalidCount: result.invalidTokens.length,
        tickets: result.tickets.map((t) => ({
          status: t.status,
          id: t.status === "ok" ? t.id : undefined,
          error: t.status === "error" ? t.details?.error : undefined,
        })),
      },
    });
  } catch (error: any) {
    logger.error("[FollowupPush] Test diagnostic dispatch error", {
      error: error?.message || String(error),
    });
    return res.status(500).json({ message: "Internal server error triggering test follow-up push." });
  }
};
