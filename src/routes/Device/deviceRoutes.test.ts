import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";

import prisma from "../../config/prisma";
import * as overdueService from "../../services/User/overdueFollowup.service";
import * as mandatoryService from "../../services/User/mandatoryFollowupContinuation.service";
import { invalidateOverdueFollowUpCache } from "../../middlewares/overdueFollowupMiddleware";
import { invalidateMandatoryFollowUpCache } from "../../middlewares/mandatoryFollowupMiddleware";
import { protect } from "../../middlewares/authMiddleware";
import deviceRoutes from "./deviceRoutes";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
process.env.JWT_SECRET = JWT_SECRET;

describe("Device Push Notification Registration Follow-Up Lock Bypass", () => {
  let server: http.Server;
  let baseUrl: string;

  // Preserve original methods for cleanup
  const originalUserFindUnique = prisma.user.findUnique;
  const originalWorkspaceFindFirst = prisma.workspace.findFirst;
  const originalDeviceUpdateMany = prisma.device.updateMany;
  const originalDeviceUpsert = prisma.device.upsert;
  const originalGetOverdueState = overdueService.getOverdueMandatorySessionState;
  const originalGetMandatoryState = mandatoryService.getMandatoryFollowUpSessionState;

  const mockUser = {
    id: "usr_test_123",
    email: "rep@example.com",
    isActive: true,
    isOnboarded: true,
    deletedAt: null,
    workspaceId: "ws_test_456",
    roleId: "role_rep",
    role: {
      id: "role_rep",
      name: "sales_rep",
      workspaceId: "ws_test_456",
    },
    workspace: {
      id: "ws_test_456",
      companyName: "Test Company",
      billingStatus: "ACTIVE",
      approvedUserLimit: 10,
      accessFrom: new Date(Date.now() - 86400000),
      accessUntil: new Date(Date.now() + 86400000 * 30),
      lockedAt: null,
      lockReason: null,
      suspendReason: null,
    },
  };

  const validToken = jwt.sign({ userId: mockUser.id }, JWT_SECRET);

  beforeEach(async () => {
    // Invalidate overdue/mandatory caches for the test user
    invalidateOverdueFollowUpCache(mockUser.id);
    invalidateMandatoryFollowUpCache(mockUser.id);

    // Mock Prisma user & workspace lookup
    (prisma.user.findUnique as any) = async ({ where }: any) => {
      if (where.id === mockUser.id) {
        return { ...mockUser };
      }
      return null;
    };

    (prisma.workspace.findFirst as any) = async () => null;

    // Mock device storage operations
    (prisma.device.updateMany as any) = async () => ({ count: 1 });
    (prisma.device.upsert as any) = async ({ create, update }: any) => ({
      id: "dev_rec_1",
      deviceId: create.deviceId,
      userId: create.userId,
      pushToken: create.pushToken,
      pushProvider: create.pushProvider || "EXPO",
      pushEnabled: true,
      os: create.os,
      appVersion: create.appVersion,
      deviceType: create.deviceType,
      lastActive: new Date(),
    });

    // Mock overdue follow-up state: user HAS overdue follow-ups!
    (overdueService.getOverdueMandatorySessionState as any) = async () => ({
      overdueFollowupRequired: true,
      overdueFollowupCount: 2,
      todayTotalCount: 2,
      todayCompletedCount: 0,
      todayUtilizationRequired: true,
      todayPendingCount: 2,
      lifecycleExtensionLimitHours: 24,
      items: [
        { id: "fu_1", leadId: "lead_1" },
        { id: "fu_2", leadId: "lead_2" },
      ],
    });

    // Mock mandatory follow-up continuation: also pending
    (mandatoryService.getMandatoryFollowUpSessionState as any) = async () => ({
      mandatoryFollowupRequired: true,
      mandatoryFollowupCount: 1,
      items: [{ leadId: "lead_1" }],
    });

    // Spin up an Express test application
    const app = express();
    app.use(express.json());

    // Mount device routes under /api/devices
    app.use("/api/devices", deviceRoutes);

    // Mount a normal CRM endpoint protected by protect to test regression
    app.get("/api/leads", protect, (_req, res) => {
      res.status(200).json({ success: true, message: "CRM data accessed" });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Restore mocks
    prisma.user.findUnique = originalUserFindUnique;
    prisma.workspace.findFirst = originalWorkspaceFindFirst;
    prisma.device.updateMany = originalDeviceUpdateMany;
    prisma.device.upsert = originalDeviceUpsert;
    (overdueService as any).getOverdueMandatorySessionState = originalGetOverdueState;
    (mandatoryService as any).getMandatoryFollowUpSessionState = originalGetMandatoryState;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("Test A: Authenticated user WITH overdue follow-ups -> POST /api/devices/register => MUST succeed", async () => {
    let upsertCalledWith: any = null;
    let updateManyCalled = false;

    (prisma.device.updateMany as any) = async () => {
      updateManyCalled = true;
      return { count: 0 };
    };

    (prisma.device.upsert as any) = async (args: any) => {
      upsertCalledWith = args;
      return {
        id: "dev_999",
        deviceId: args.create.deviceId,
        userId: args.create.userId,
        pushToken: args.create.pushToken,
        pushProvider: args.create.pushProvider,
        pushEnabled: true,
        lastActive: new Date(),
      };
    };

    const response = await fetch(`${baseUrl}/api/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
        "x-device-id": "android-device-uuid-1234",
      },
      body: JSON.stringify({
        pushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        pushProvider: "EXPO",
        appVersion: "1.2.0",
        os: "android",
        platform: "Android 14",
        deviceName: "Pixel 7 Pro",
      }),
    });

    assert.equal(response.status, 200, `Expected 200 OK but received ${response.status}`);
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.message, "Device push token registered successfully.");
    assert.equal(body.data.deviceId, "android-device-uuid-1234");
    assert.equal(body.data.pushEnabled, true);

    // Verify DB calls were made correctly
    assert.equal(updateManyCalled, true, "Conflicting token invalidation updateMany should be called");
    assert.ok(upsertCalledWith, "Device upsert should be called");
    assert.equal(upsertCalledWith.where.userId_deviceId.userId, mockUser.id);
    assert.equal(upsertCalledWith.where.userId_deviceId.deviceId, "android-device-uuid-1234");
    assert.equal(upsertCalledWith.create.userId, mockUser.id);
    assert.equal(upsertCalledWith.create.deviceId, "android-device-uuid-1234");
    assert.equal(upsertCalledWith.create.pushToken, "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]");
    assert.equal(upsertCalledWith.create.pushEnabled, true);
    assert.equal(upsertCalledWith.create.os, "android");
  });

  test("Test B: Unauthenticated request -> POST /api/devices/register => MUST still return authentication error", async () => {
    let upsertCalled = false;
    (prisma.device.upsert as any) = async () => {
      upsertCalled = true;
      return {};
    };

    const response = await fetch(`${baseUrl}/api/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // NO Authorization header provided
        "x-device-id": "android-device-uuid-1234",
      },
      body: JSON.stringify({
        pushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
      }),
    });

    assert.equal(response.status, 401, `Expected 401 Unauthorized but received ${response.status}`);
    const body = await response.json();
    assert.equal(body.reason, "Token missing");
    assert.equal(upsertCalled, false, "Device upsert must NEVER be called for unauthenticated requests");
  });

  test("Test C: Authenticated user WITH overdue follow-ups -> POST /api/devices/unregister => MUST succeed", async () => {
    let updateManyArgs: any = null;

    (prisma.device.updateMany as any) = async (args: any) => {
      updateManyArgs = args;
      return { count: 1 };
    };

    const response = await fetch(`${baseUrl}/api/devices/unregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
        "x-device-id": "android-device-uuid-1234",
      },
      body: JSON.stringify({
        pushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
      }),
    });

    assert.equal(response.status, 200, `Expected 200 OK but received ${response.status}`);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.message, "Device push token unregistered successfully.");

    assert.ok(updateManyArgs, "Device updateMany should be called on unregister");
    assert.equal(updateManyArgs.where.userId, mockUser.id);
    assert.equal(updateManyArgs.data.pushToken, null);
    assert.equal(updateManyArgs.data.pushEnabled, false);
  });

  test("Test D: Normal CRM endpoint that is supposed to be blocked by overdue follow-ups => MUST remain blocked", async () => {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    });

    assert.equal(response.status, 423, `Expected 423 Locked for CRM endpoint but received ${response.status}`);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.errorCode, "OVERDUE_FOLLOWUP_REQUIRED");
    assert.equal(body.message, "You have overdue follow-ups. Complete or extend them before continuing.");
    assert.equal(body.overdueFollowupCount, 2);
  });
});
