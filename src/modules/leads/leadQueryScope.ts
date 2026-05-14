import type { Prisma } from '@prisma/client';

/**
 * Merges optional lead-visibility scope (from permissions) with extra lead predicates.
 * Used by dashboard + LOB helpers so counts match list views (OWN / TEAM / ALL).
 */
export const mergeWorkspaceLeadFilters = (
  workspaceId: string,
  leadAccess: Prisma.LeadWhereInput,
  extra: Prisma.LeadWhereInput = {},
): Prisma.LeadWhereInput => {
  const base: Prisma.LeadWhereInput = {
    workspaceId,
    deletedAt: null,
  };
  const hasAccess = leadAccess && Object.keys(leadAccess).length > 0;
  const hasExtra = extra && Object.keys(extra).length > 0;
  if (!hasAccess && !hasExtra) return base;
  if (!hasAccess) return { ...base, ...extra };
  if (!hasExtra) return { ...base, ...leadAccess };
  return { ...base, AND: [leadAccess, extra] };
};
