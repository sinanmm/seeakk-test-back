/**
 * Shared rules for who may receive or accept a workspace invitation.
 * Invited users are created inactive, unverified, and not onboarded until they accept the link.
 */

export type InviteEligibilityUser = {
  isActive?: boolean | null;
  isEmailVerified?: boolean | null;
  isOnboarded?: boolean | null;
  role?: { id?: string | null; name?: string | null } | null;
};

/** User finished onboarding (accepted invite or was provisioned with credentials). */
export const userHasActivatedAccount = (user: InviteEligibilityUser): boolean => {
  if (user.isOnboarded === true) return true;
  if (user.isOnboarded === false) return false;
  return user.isActive === true && user.isEmailVerified === true;
};

/** Former member who was verified then deactivated — use reactivate / reset password. */
export const userIsDeactivatedFormerMember = (user: InviteEligibilityUser): boolean =>
  user.isEmailVerified === true && user.isActive !== true;

/** May receive a new invite email (inactive provisioning, not yet onboarded). */
export const userIsInvitePending = (user: InviteEligibilityUser): boolean => {
  if (!user.role?.id) return false;
  if (userIsDeactivatedFormerMember(user)) return false;
  return !userHasActivatedAccount(user);
};

export const getInviteSendBlockReason = (user: InviteEligibilityUser): string | null => {
  if (!user.role?.id) {
    return 'Assign a role before sending invite.';
  }
  if (userHasActivatedAccount(user)) {
    return 'This user already has an active account. Use reset password if they need access.';
  }
  if (userIsDeactivatedFormerMember(user)) {
    return 'This account was deactivated. Reactivate it or reset the password instead of sending an invite.';
  }
  if (!userIsInvitePending(user)) {
    return 'This user is not eligible for an invitation.';
  }
  return null;
};
