/**
 * Shared rules for who may receive or accept a workspace invitation.
 * Invited users are created without a password until they accept the link.
 */

export type InviteEligibilityUser = {
  isActive?: boolean | null;
  isEmailVerified?: boolean | null;
  isOnboarded?: boolean | null;
  hasPassword?: boolean | null;
  role?: { id?: string | null; name?: string | null } | null;
};

export const toInviteEligibilityUser = (user: {
  isActive?: boolean | null;
  isEmailVerified?: boolean | null;
  isOnboarded?: boolean | null;
  password?: string | null;
  hasPassword?: boolean | null;
  role?: { id?: string | null; name?: string | null } | null;
}): InviteEligibilityUser => ({
  isActive: user.isActive,
  isEmailVerified: user.isEmailVerified,
  isOnboarded: user.isOnboarded,
  hasPassword: user.hasPassword ?? Boolean(user.password),
  role: user.role,
});

/** User completed credential setup and may log in normally. */
export const userHasActivatedAccount = (user: InviteEligibilityUser): boolean => {
  if (user.hasPassword === false) return false;
  if (user.isOnboarded === false) return false;
  if (user.hasPassword === true) {
    return user.isActive === true && user.isEmailVerified === true;
  }
  if (user.isOnboarded === true) return true;
  return user.isActive === true && user.isEmailVerified === true;
};

/** Former member who was verified then deactivated — use reactivate / reset password. */
export const userIsDeactivatedFormerMember = (user: InviteEligibilityUser): boolean =>
  user.isEmailVerified === true && user.isActive !== true;

/** UI / reporting: user still needs to accept an invite or set a password. */
export const userIsInvitePending = (user: InviteEligibilityUser): boolean => {
  if (!user.role?.id) return false;
  if (userIsDeactivatedFormerMember(user)) return false;
  return !userHasActivatedAccount(user);
};

/** Blocks admin invite link generation when another account action is required. */
export const getInviteSendBlockReason = (user: InviteEligibilityUser): string | null => {
  if (!user.role?.id) {
    return 'Assign a role before sending invite.';
  }
  if (userIsDeactivatedFormerMember(user)) {
    return 'This account was deactivated. Reactivate it or reset the password instead of sending an invite.';
  }
  return null;
};
