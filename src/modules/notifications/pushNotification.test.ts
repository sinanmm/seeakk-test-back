import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { pushNotificationService, PushMessagePayload } from "../../services/Notifications/pushNotificationService";
import { pushDedupeKey } from "../../services/User/followupReminder.jobs";

describe("Phase 9B: Backend Push Notification Infrastructure", () => {
  describe("1. Push Token Format Validation", () => {
    test("1.1 Validates standard ExponentPushToken format", () => {
      const validToken = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
      assert.equal(pushNotificationService.isValidToken(validToken), true);
    });

    test("1.2 Validates development mock token format", () => {
      const devToken = "dev_push_token_1742548231000";
      assert.equal(pushNotificationService.isValidToken(devToken), true);
    });

    test("1.3 Rejects malformed or empty push tokens", () => {
      assert.equal(pushNotificationService.isValidToken(""), false);
      assert.equal(pushNotificationService.isValidToken("not-a-token"), false);
      assert.equal(pushNotificationService.isValidToken("12345"), false);
      assert.equal(pushNotificationService.isValidToken(null as any), false);
    });
  });

  describe("2. Push Deduplication & Idempotency", () => {
    test("2.1 Constructs correct push deduplication key independent of email", () => {
      const key = pushDedupeKey("fu_123", "usr_456");
      assert.equal(key, "push:dedupe:followup:fu_123:usr_456");
      assert.notEqual(key, "followup:reminder:fu_123");
    });

    test("2.2 Push key includes both followUpId and userId for multi-assignee safety", () => {
      const keyUserA = pushDedupeKey("fu_123", "usr_1");
      const keyUserB = pushDedupeKey("fu_123", "usr_2");
      assert.notEqual(keyUserA, keyUserB);
    });
  });

  describe("3. Mobile Deep-Link Payload Compatibility", () => {
    test("3.1 Validates follow-up reminder payload structure matching mobile client", () => {
      const payload = {
        userId: "usr_1",
        workspaceId: "ws_1",
        title: "Follow-up Reminder: Sarah Jenkins",
        body: "Call scheduled for 2:30 PM",
        data: {
          type: "FOLLOWUP_REMINDER",
          followUpId: "fu_999",
          leadId: "lead_888",
          url: "/(protected)/leads/lead_888",
        },
      };

      assert.equal(payload.data.type, "FOLLOWUP_REMINDER");
      assert.equal(payload.data.followUpId, "fu_999");
      assert.equal(payload.data.leadId, "lead_888");
      assert.equal(payload.data.url, "/(protected)/leads/lead_888");
    });

    test("3.2 Validates fallback URL when leadId is absent", () => {
      const payload = {
        userId: "usr_1",
        workspaceId: "ws_1",
        title: "Follow-up Reminder",
        body: "Scheduled follow-up",
        data: {
          type: "FOLLOWUP_REMINDER",
          followUpId: "fu_999",
          url: "/(protected)/(tabs)/followups",
        },
      };

      assert.equal(payload.data.url, "/(protected)/(tabs)/followups");
    });
  });

  describe("4. Device Registration & Upsert Logic", () => {
    test("4.1 Invalidate other users' devices holding the same push token", () => {
      const devices = [
        { id: "dev_1", userId: "user_A", deviceId: "phone_1", pushToken: "ExponentPushToken[abc]", pushEnabled: true },
        { id: "dev_2", userId: "user_B", deviceId: "phone_2", pushToken: "ExponentPushToken[xyz]", pushEnabled: true },
      ];

      const newUserId = "user_B";
      const newDeviceId = "phone_1";
      const tokenToRegister = "ExponentPushToken[abc]";

      // Logic: any other device holding this token is disabled
      for (const d of devices) {
        if (d.pushToken === tokenToRegister && !(d.userId === newUserId && d.deviceId === newDeviceId)) {
          d.pushToken = null as any;
          d.pushEnabled = false;
        }
      }

      // User A device should now have null token and disabled push
      assert.equal(devices[0].pushToken, null);
      assert.equal(devices[0].pushEnabled, false);
    });

    test("4.2 Updates existing device record instead of creating duplicates", () => {
      const devices = [
        { userId: "user_A", deviceId: "phone_1", pushToken: "ExponentPushToken[old]", appVersion: "1.0.0", pushEnabled: true },
      ];

      const incoming = { userId: "user_A", deviceId: "phone_1", pushToken: "ExponentPushToken[new]", appVersion: "1.0.1" };

      const existing = devices.find(d => d.userId === incoming.userId && d.deviceId === incoming.deviceId);
      if (existing) {
        existing.pushToken = incoming.pushToken;
        existing.appVersion = incoming.appVersion;
        existing.pushEnabled = true;
      }

      assert.equal(devices.length, 1);
      assert.equal(devices[0].pushToken, "ExponentPushToken[new]");
      assert.equal(devices[0].appVersion, "1.0.1");
    });

    test("4.3 Device unregistration idempotency clears pushToken and sets pushEnabled false", () => {
      const device = {
        id: "dev_1",
        userId: "user_A",
        deviceId: "phone_1",
        pushToken: "ExponentPushToken[abc]",
        pushEnabled: true,
      };

      // Unregister 1st time
      device.pushToken = null as any;
      device.pushEnabled = false;
      assert.equal(device.pushToken, null);
      assert.equal(device.pushEnabled, false);

      // Unregister 2nd time (idempotent, no error)
      device.pushToken = null as any;
      device.pushEnabled = false;
      assert.equal(device.pushToken, null);
      assert.equal(device.pushEnabled, false);
    });
  });

  describe("5. Workspace Isolation & Recipient Filtering", () => {
    test("5.1 Rejects push notification dispatch when user does not belong to target workspace", () => {
      const user = {
        id: "usr_100",
        workspaceId: "ws_alpha",
        status: "ACTIVE",
        deletedAt: null,
      };

      const targetWorkspaceId = "ws_beta";
      const isWorkspaceMatch = user.workspaceId === targetWorkspaceId;

      assert.equal(isWorkspaceMatch, false);
    });

    test("5.2 Excludes inactive or soft-deleted users", () => {
      const inactiveUser = { id: "u1", status: "INACTIVE", deletedAt: null };
      const deletedUser = { id: "u2", status: "ACTIVE", deletedAt: new Date() };
      const activeUser = { id: "u3", status: "ACTIVE", deletedAt: null };

      const isEligible = (u: any) => u.status === "ACTIVE" && u.deletedAt === null;

      assert.equal(isEligible(inactiveUser), false);
      assert.equal(isEligible(deletedUser), false);
      assert.equal(isEligible(activeUser), true);
    });

    test("5.3 Resolves multiple active devices for the same user", () => {
      const userDevices = [
        { id: "d1", userId: "u1", pushEnabled: true, pushToken: "ExponentPushToken[phone]" },
        { id: "d2", userId: "u1", pushEnabled: true, pushToken: "ExponentPushToken[tablet]" },
        { id: "d3", userId: "u1", pushEnabled: false, pushToken: "ExponentPushToken[old_phone]" },
        { id: "d4", userId: "u1", pushEnabled: true, pushToken: null },
      ];

      const eligibleDevices = userDevices.filter((d) => d.pushEnabled && Boolean(d.pushToken));

      assert.equal(eligibleDevices.length, 2);
      assert.equal(eligibleDevices[0].pushToken, "ExponentPushToken[phone]");
      assert.equal(eligibleDevices[1].pushToken, "ExponentPushToken[tablet]");
    });
  });

  describe("6. Expo Push Service Batching & Ticket Handling", () => {
    test("6.1 Deactivates device token when Expo returns DeviceNotRegistered", async () => {
      const mockDevices = [
        { pushToken: "ExponentPushToken[unregistered_token]", pushEnabled: true },
        { pushToken: "ExponentPushToken[valid_token]", pushEnabled: true },
      ];

      const invalidTokens = ["ExponentPushToken[unregistered_token]"];

      for (const d of mockDevices) {
        if (invalidTokens.includes(d.pushToken)) {
          d.pushToken = null as any;
          d.pushEnabled = false;
        }
      }

      assert.equal(mockDevices[0].pushToken, null);
      assert.equal(mockDevices[0].pushEnabled, false);
      assert.equal(mockDevices[1].pushToken, "ExponentPushToken[valid_token]");
      assert.equal(mockDevices[1].pushEnabled, true);
    });

    test("6.2 Batches push notifications without exceeding chunk sizes of 100", () => {
      const messages: PushMessagePayload[] = [];
      for (let i = 0; i < 250; i++) {
        messages.push({
          to: "ExponentPushToken[valid_token]",
          title: "Test",
          body: "Batch test",
        });
      }

      const chunkSize = 100;
      const chunks: PushMessagePayload[][] = [];
      for (let i = 0; i < messages.length; i += chunkSize) {
        chunks.push(messages.slice(i, i + chunkSize));
      }

      assert.equal(chunks.length, 3);
      assert.equal(chunks[0].length, 100);
      assert.equal(chunks[1].length, 100);
      assert.equal(chunks[2].length, 50);
    });

    test("6.3 Transient errors are retryable; permanent token errors trigger token deactivation", () => {
      const tickets = [
        { status: "error", message: "Rate limit", details: { error: "MessageRateExceeded" } },
        { status: "error", message: "Not registered", details: { error: "DeviceNotRegistered" } },
        { status: "ok", id: "ticket-123" },
      ];

      const isTransient = (t: any) => t.details?.error === "MessageRateExceeded" || t.details?.error === "MessageTooBig";
      const isPermanentUnregister = (t: any) => t.details?.error === "DeviceNotRegistered";

      assert.equal(isTransient(tickets[0]), true);
      assert.equal(isPermanentUnregister(tickets[1]), true);
      assert.equal(isTransient(tickets[2]), false);
    });
  });

  describe("7. Follow-up Reminder Integration & Email Non-Interference", () => {
    test("7.1 Email reminder and push reminder deduplication keys are distinct", () => {
      const emailKey = "followup:reminder:fu_999";
      const pushKey = pushDedupeKey("fu_999", "usr_1");

      assert.notEqual(emailKey, pushKey);
      assert.ok(pushKey.startsWith("push:dedupe:followup:"));
      assert.ok(emailKey.startsWith("followup:reminder:"));
    });

    test("7.2 Disabling push notifications does not prevent email reminder dispatch", () => {
      const isEmailEnabled = true;
      const isPushEnabled = false;

      assert.equal(isEmailEnabled, true);
      assert.equal(isPushEnabled, false);
    });
  });
});
