import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export type AccessDecisionReason =
  | 'COMPANY_SUSPENDED'
  | 'COMPANY_LOCKED'
  | 'PAID_ACTIVE'
  | 'GRACE_ACTIVE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_REQUIRED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'LEGACY_UNMANAGED';

export type EntitlementSource = 'PAID' | 'GRACE' | 'LEGACY' | 'NONE';

export interface AccessDecision {
  isAllowed: boolean;
  reason: AccessDecisionReason;
  message: string;
  entitlementSource: EntitlementSource;
  seatLimit: number | null;
  expiresAt: Date | null;
  canRenew: boolean;
}

/**
 * Evaluates the authoritative request-time access decision for a company.
 * Priority order (Part 12):
 * 1. SUSPENDED -> Block (403)
 * 2. MANUAL LOCK -> Block (403)
 * 3. VALID PAID ACCESS -> Allow (PAID)
 * 4. VALID GRACE -> Allow (GRACE)
 * 5. VALID CURRENT PAID ACCESS + FUTURE RENEWAL PAYMENT_PENDING -> Allow (PAID, early renewal doesn't block)
 * 6. PAYMENT_PENDING without valid current paid access/grace -> Block (402)
 * 7. PAYMENT_REQUIRED -> Block (402)
 * 8. EXPIRED -> Block (402)
 * 9. LEGACY UNMANAGED -> Allow (LEGACY)
 */
export const evaluateCompanyAccess = async (workspace: any): Promise<AccessDecision> => {
  if (!workspace) {
    return {
      isAllowed: false,
      reason: 'PAYMENT_REQUIRED',
      message: 'Workspace not found.',
      entitlementSource: 'NONE',
      seatLimit: null,
      expiresAt: null,
      canRenew: false,
    };
  }

  const now = new Date();

  // 1. SUSPENDED (Highest Priority)
  if (workspace.suspendReason || workspace.billingStatus === 'SUSPENDED') {
    return {
      isAllowed: false,
      reason: 'COMPANY_SUSPENDED',
      message: workspace.suspendReason || 'This workspace has been suspended by platform administration.',
      entitlementSource: 'NONE',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil || null,
      canRenew: false,
    };
  }

  // 2. MANUAL LOCK
  if (workspace.lockedAt || workspace.lockReason || workspace.billingStatus === 'LOCKED') {
    return {
      isAllowed: false,
      reason: 'COMPANY_LOCKED',
      message: workspace.lockReason || 'This workspace has been locked by administration.',
      entitlementSource: 'NONE',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil || null,
      canRenew: false,
    };
  }

  // 3. Check for Valid Paid Access
  const hasPaidAccess = Boolean(workspace.accessUntil && new Date(workspace.accessUntil) > now);

  if (hasPaidAccess && (workspace.billingStatus === 'ACTIVE' || workspace.billingStatus === 'PAYMENT_PENDING')) {
    // Note: If customer has an active subscription and submits an early renewal (PAYMENT_PENDING),
    // they continue using the app under their current paid entitlement! (Part 30)
    return {
      isAllowed: true,
      reason: 'PAID_ACTIVE',
      message: 'Active subscription.',
      entitlementSource: 'PAID',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil,
      canRenew: true,
    };
  }

  // 4. Check for Valid Grace Period
  const activeGrace = await prisma.graceRecord.findFirst({
    where: {
      workspaceId: workspace.id,
      status: 'ACTIVE',
      graceUntil: { gt: now },
    },
    orderBy: { graceUntil: 'desc' },
  });

  if (activeGrace) {
    return {
      isAllowed: true,
      reason: 'GRACE_ACTIVE',
      message: 'Active under temporary grace period.',
      entitlementSource: 'GRACE',
      seatLimit: activeGrace.allowedUserLimit,
      expiresAt: activeGrace.graceUntil,
      canRenew: true,
    };
  }

  // 5. PAYMENT_PENDING without active paid or grace
  if (workspace.billingStatus === 'PAYMENT_PENDING') {
    return {
      isAllowed: false,
      reason: 'PAYMENT_PENDING',
      message: 'Payment verification is pending approval.',
      entitlementSource: 'NONE',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil || null,
      canRenew: false,
    };
  }

  // 6. PAYMENT_REQUIRED
  if (workspace.billingStatus === 'PAYMENT_REQUIRED') {
    return {
      isAllowed: false,
      reason: 'PAYMENT_REQUIRED',
      message: 'Payment is required to access this workspace.',
      entitlementSource: 'NONE',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil || null,
      canRenew: true,
    };
  }

  // 7. EXPIRED (accessUntil has passed)
  if (workspace.accessUntil && new Date(workspace.accessUntil) <= now) {
    return {
      isAllowed: false,
      reason: 'SUBSCRIPTION_EXPIRED',
      message: 'Your subscription has expired. Please renew to continue.',
      entitlementSource: 'NONE',
      seatLimit: workspace.approvedUserLimit || null,
      expiresAt: workspace.accessUntil,
      canRenew: true,
    };
  }

  // 8. LEGACY UNMANAGED WORKSPACE (billingStatus is null/undefined)
  if (!workspace.billingStatus && !workspace.accessUntil) {
    return {
      isAllowed: true,
      reason: 'LEGACY_UNMANAGED',
      message: 'Legacy unmanaged workspace.',
      entitlementSource: 'LEGACY',
      seatLimit: null,
      expiresAt: null,
      canRenew: false,
    };
  }

  // Default fallback if billingStatus unknown or expired
  return {
    isAllowed: false,
    reason: 'PAYMENT_REQUIRED',
    message: 'Subscription payment required.',
    entitlementSource: 'NONE',
    seatLimit: workspace.approvedUserLimit || null,
    expiresAt: workspace.accessUntil || null,
    canRenew: true,
  };
};
