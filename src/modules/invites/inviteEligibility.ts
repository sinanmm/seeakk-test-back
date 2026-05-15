/**
 * Shared rules for who may receive or accept a workspace invitation.
 * Invited users are created inactive and unverified until they accept the link.
 */

export type InviteEligibilityUser = {
  isActive?: boolean | null;
  isEmailVerified?: boolean | null;
  role?: { id?: string | null; name?: string | null } | null;
};

/** User was provisioned with credentials or already activated — not invite-pending. */
export const userIsInvitePending = (user: InviteEligibilityUser): boolean => {
  if (user.isActive === true) return false;
  if (user.isEmailVerified === true) return false;
  return Boolean(user.role?.id);
};

export const getInviteSendBlockReason = (user: InviteEligibilityUser): string | null => {
  if (!user.role?.id) {
    return 'Assign a role before sending invite.';
  }
  if (user.isActive === true && user.isEmailVerified === true) {
    return 'This user already has an active account. Use reset password if they need access.';
  }
  if (user.isEmailVerified === true && user.isActive !== true) {
    return 'This account was deactivated. Reactivate it or reset the password instead of sending an invite.';
  }
  if (!userIsInvitePending(user)) {
    return 'This user is not eligible for an invitation.';
  }
  return null;
};
