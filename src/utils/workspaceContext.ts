import prisma from '../config/prisma';

/**
 * Resolves workspace id for API handlers: uses membership on the user row when set,
 * otherwise falls back to a workspace this user owns (ownerId). Fixes cases where
 * workspace exists but user.workspaceId was never set.
 */
export async function resolveWorkspaceIdForUser(
  userId: string,
  membershipHint?: string | null,
): Promise<string | null> {
  const hint = membershipHint?.trim();
  if (hint) return hint;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { workspaceId: true },
  });

  if (user?.workspaceId?.trim()) {
    return user.workspaceId.trim();
  }

  const owned = await prisma.workspace.findUnique({
    where: { ownerId: userId },
    select: { id: true },
  });

  return owned?.id ?? null;
}
