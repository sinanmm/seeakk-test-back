import type { Prisma } from '@prisma/client';

/**
 * Closed module (Lead Management → Closed, revenue, closed reports):
 * converted / won outcomes only — never LOB.
 */
export const closedModuleLeadWhere = (): Prisma.LeadWhereInput => ({
  isLOB: false,
  NOT: {
    stage: {
      is: {
        isLOB: true,
      },
    },
  },
  OR: [
    { isClosed: true },
    {
      stage: {
        is: {
          isClosed: true,
          isLOB: false,
        },
      },
    },
  ],
});

/** LOB Analysis: lost / out-of-business outcomes only. */
export const lobModuleLeadWhere = (): Prisma.LeadWhereInput => ({
  OR: [{ isLOB: true }, { stage: { is: { isLOB: true } } }],
});

export const isClosedWonStage = (stage?: { isClosed?: boolean | null; isLOB?: boolean | null } | null): boolean =>
  Boolean(stage?.isClosed && !stage?.isLOB);

export const isLobStage = (stage?: { isLOB?: boolean | null; name?: string | null } | null): boolean =>
  Boolean(stage?.isLOB);

export const buildLeadOutcomeFlagsFromStage = (
  stage: { isClosed?: boolean | null; isLOB?: boolean | null } | null,
  actorId: string,
  existing?: {
    isClosed?: boolean;
    closedAt?: Date | null;
    closedById?: string | null;
    closureType?: string | null;
    generatedRevenue?: number | null;
  },
) => {
  const now = new Date();
  const lob = isLobStage(stage);
  const closedWon = isClosedWonStage(stage);

  if (!lob && !closedWon) {
    return {
      isLOB: false,
      isClosed: false,
      closedAt: null as Date | null,
      closedById: null as string | null,
      closureType: null as string | null,
      generatedRevenue: existing?.generatedRevenue ?? 0,
    };
  }

  if (lob) {
    return {
      isLOB: true,
      isClosed: false,
      closedAt: existing?.closedAt || now,
      closedById: existing?.closedById || actorId,
      closureType: 'LOST' as const,
      generatedRevenue: existing?.generatedRevenue ?? 0,
    };
  }

  return {
    isLOB: false,
    isClosed: true,
    closedAt: existing?.closedAt || now,
    closedById: existing?.closedById || actorId,
    closureType: (existing?.closureType as any) || ('WON' as const),
    generatedRevenue: existing?.generatedRevenue ?? 0,
  };
};
