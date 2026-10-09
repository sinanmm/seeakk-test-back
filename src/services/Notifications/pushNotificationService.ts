import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import prisma from "../../config/prisma";
import logger from "../../utils/logger";

export interface PushMessagePayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export interface PushSendResult {
  sentCount: number;
  invalidTokens: string[];
  tickets: ExpoPushTicket[];
}

class PushNotificationService {
  private expo: Expo;

  constructor() {
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim() || undefined;
    this.expo = new Expo({ accessToken });
  }

  /**
   * Validates whether a token matches the standard Expo push token format.
   */
  public isValidToken(token: string): boolean {
    if (!token || typeof token !== "string") return false;
    if (token.startsWith("dev_push_token_")) return true;
    return Expo.isExpoPushToken(token);
  }

  /**
   * Sends batches of push notification messages via Expo Push Service.
   */
  public async sendPushNotifications(
    messages: PushMessagePayload[],
  ): Promise<PushSendResult> {
    const validMessages: ExpoPushMessage[] = [];
    const invalidTokens: string[] = [];
    const allTickets: ExpoPushTicket[] = [];

    for (const msg of messages) {
      if (Expo.isExpoPushToken(msg.to)) {
        validMessages.push({
          to: msg.to,
          sound: msg.sound ?? "default",
          title: msg.title,
          body: msg.body,
          data: msg.data || {},
          badge: msg.badge,
        });
      } else if (String(msg.to).startsWith("dev_push_token_")) {
        // Safe dev-mock handling
        logger.info("[PushNotificationService] Simulating push to development token", {
          tokenPrefix: String(msg.to).substring(0, 15),
          title: msg.title,
        });
      } else {
        invalidTokens.push(msg.to);
      }
    }

    if (validMessages.length === 0) {
      return { sentCount: 0, invalidTokens, tickets: allTickets };
    }

    const chunks = this.expo.chunkPushNotifications(validMessages);

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        allTickets.push(...tickets);

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === "error") {
            const errorType = ticket.details?.error;
            const targetToken = chunk[i]?.to;
            const singleToken = typeof targetToken === "string" ? targetToken : (targetToken as string[])?.[0];

            logger.warn("[PushNotificationService] Ticket delivery error", {
              errorType,
              message: ticket.message,
              token: singleToken ? singleToken.substring(0, 15) + "..." : "unknown",
            });

            if (errorType === "DeviceNotRegistered" && singleToken) {
              invalidTokens.push(singleToken);
            }
          }
        }
      } catch (error: any) {
        logger.error("[PushNotificationService] Failed to send push batch chunk", {
          error: error?.message || String(error),
        });
        throw error; // Let BullMQ retry on network/transient failures
      }
    }

    if (invalidTokens.length > 0) {
      await this.deactivateInvalidDeviceTokens(invalidTokens);
    }

    return {
      sentCount: validMessages.length,
      invalidTokens,
      tickets: allTickets,
    };
  }

  /**
   * Automatically disables devices that received DeviceNotRegistered errors.
   */
  public async deactivateInvalidDeviceTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;

    try {
      const result = await prisma.device.updateMany({
        where: {
          pushToken: { in: tokens },
        },
        data: {
          pushToken: null,
          pushEnabled: false,
        },
      });

      logger.info("[PushNotificationService] Deactivated invalid device push tokens", {
        count: result.count,
      });

      return result.count;
    } catch (error: any) {
      logger.error("[PushNotificationService] Error deactivating invalid tokens", {
        error: error?.message || String(error),
      });
      return 0;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
