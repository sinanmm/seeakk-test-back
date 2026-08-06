import prisma from '../../config/prisma';

export interface CallReportFilters {
  startDate?: string;
  endDate?: string;
  userIds?: string[];
  supervisorId?: string;
  officeId?: string;
  departmentId?: string;
  leadStageId?: string;
  substageId?: string;
  connectionStatus?: 'CONNECTED' | 'NOT_CONNECTED';
  sourceContext?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const getCallSummaryReport = async (
  workspaceId: string,
  requestingUserId: string,
  permissions: { viewAll: boolean; viewAssigned: boolean; viewOwn: boolean },
  filters: CallReportFilters,
) => {
  // 1. Determine user scope
  let allowedUserIds: string[] | null = null;

  if (!permissions.viewAll) {
    if (permissions.viewAssigned) {
      const subordinates = await (prisma as any).user.findMany({
        where: { supervisorId: requestingUserId, workspaceId, deletedAt: null },
        select: { id: true },
      });
      allowedUserIds = [requestingUserId, ...subordinates.map((s: any) => s.id)];
    } else {
      allowedUserIds = [requestingUserId];
    }
  }

  // 2. Build where clause for Call Sessions & Outcomes
  const sessionWhere: any = {
    workspaceId,
  };

  const outcomeWhere: any = {
    workspaceId,
  };

  // User Filter
  if (filters.userIds && filters.userIds.length > 0) {
    const requested = allowedUserIds
      ? filters.userIds.filter((id) => allowedUserIds!.includes(id))
      : filters.userIds;
    sessionWhere.initiatedById = { in: requested };
    outcomeWhere.userId = { in: requested };
  } else if (allowedUserIds) {
    sessionWhere.initiatedById = { in: allowedUserIds };
    outcomeWhere.userId = { in: allowedUserIds };
  }

  // Supervisor / Department / Office Filter on User
  if (filters.supervisorId || filters.departmentId || filters.officeId) {
    const userWhere: any = { workspaceId, deletedAt: null };
    if (filters.supervisorId) userWhere.supervisorId = filters.supervisorId;
    if (filters.departmentId) userWhere.departmentId = filters.departmentId;
    if (filters.officeId) userWhere.officeId = filters.officeId;

    const matchingUsers = await (prisma as any).user.findMany({
      where: userWhere,
      select: { id: true },
    });
    const matchedIds = matchingUsers.map((u: any) => u.id);

    sessionWhere.initiatedById = sessionWhere.initiatedById
      ? { in: (sessionWhere.initiatedById.in || []).filter((id: string) => matchedIds.includes(id)) }
      : { in: matchedIds };
    outcomeWhere.userId = outcomeWhere.userId
      ? { in: (outcomeWhere.userId.in || []).filter((id: string) => matchedIds.includes(id)) }
      : { in: matchedIds };
  }

  // Date Filter
  if (filters.startDate || filters.endDate) {
    const dateFilter: any = {};
    if (filters.startDate) dateFilter.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
    if (filters.endDate) dateFilter.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
    sessionWhere.initiatedAt = dateFilter;
    outcomeWhere.submittedAt = dateFilter;
  }

  // Connection Status / Substage / LeadStage Filters
  if (filters.connectionStatus) outcomeWhere.connectionStatus = filters.connectionStatus;
  if (filters.substageId) outcomeWhere.substageId = filters.substageId;
  if (filters.leadStageId) outcomeWhere.targetStageId = filters.leadStageId;
  if (filters.sourceContext) sessionWhere.sourceContext = filters.sourceContext;

  // 3. Query Call Outcomes & Sessions
  const outcomes = await (prisma as any).leadCallOutcome.findMany({
    where: outcomeWhere,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          office: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
      substage: { select: { id: true, name: true, outcomeCategory: true } },
      callSession: { select: { localCallDate: true } },
    },
  });

  const totalSessions = await (prisma as any).leadCallSession.count({ where: sessionWhere });

  // 4. Calculate Aggregate Metrics
  const totalCalls = outcomes.length || totalSessions;
  const connectedCalls = outcomes.filter((o: any) => o.connectionStatus === 'CONNECTED').length;
  const notConnectedCalls = outcomes.filter((o: any) => o.connectionStatus === 'NOT_CONNECTED').length;
  const connectionRate = totalCalls > 0 ? Number(((connectedCalls / totalCalls) * 100).toFixed(1)) : 0;

  // Calculate Unique Calls: unique combination of (userId + leadId + localCallDate)
  const uniqueKeySet = new Set<string>();
  const leadAttemptCountMap = new Map<string, number>();

  outcomes.forEach((o: any) => {
    const dateStr = o.callSession?.localCallDate || getLocalDateStr(new Date(o.submittedAt));
    const uniqueKey = `${o.userId}_${o.leadId}_${dateStr}`;
    uniqueKeySet.add(uniqueKey);

    const leadKey = `${o.userId}_${o.leadId}`;
    leadAttemptCountMap.set(leadKey, (leadAttemptCountMap.get(leadKey) || 0) + 1);
  });

  const uniqueCalls = uniqueKeySet.size;

  let positiveOutcomes = 0;
  let negativeOutcomes = 0;
  let followUpsCreated = 0;
  let leadsMoved = 0;

  outcomes.forEach((o: any) => {
    if (o.substage?.outcomeCategory === 'POSITIVE') positiveOutcomes += 1;
    if (o.substage?.outcomeCategory === 'NEGATIVE') negativeOutcomes += 1;
    if (o.followUpId) followUpsCreated += 1;
    if (o.previousStageId && o.targetStageId && o.previousStageId !== o.targetStageId) leadsMoved += 1;
  });

  // 5. Group by User & Substage for User-Wise Table and Substage Breakdown
  const userMap = new Map<string, any>();
  const substageGlobalMap = new Map<string, any>();

  outcomes.forEach((o: any) => {
    const uid = o.userId;
    if (!userMap.has(uid)) {
      userMap.set(uid, {
        userId: uid,
        userName: o.user?.name || o.user?.email || 'Unknown User',
        userEmail: o.user?.email || '',
        officeName: o.user?.office?.name || 'N/A',
        departmentName: o.user?.department?.name || 'N/A',
        totalAttempts: 0,
        uniqueCallsSet: new Set<string>(),
        connectedCalls: 0,
        notConnectedCalls: 0,
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        followUpsCreated: 0,
        leadsMoved: 0,
        substageCounts: new Map<string, any>(),
      });
    }

    const item = userMap.get(uid);
    item.totalAttempts += 1;

    const dateStr = o.callSession?.localCallDate || getLocalDateStr(new Date(o.submittedAt));
    item.uniqueCallsSet.add(`${o.leadId}_${dateStr}`);

    if (o.connectionStatus === 'CONNECTED') item.connectedCalls += 1;
    if (o.connectionStatus === 'NOT_CONNECTED') item.notConnectedCalls += 1;
    if (o.substage?.outcomeCategory === 'POSITIVE') item.positiveOutcomes += 1;
    if (o.substage?.outcomeCategory === 'NEGATIVE') item.negativeOutcomes += 1;
    if (o.followUpId) item.followUpsCreated += 1;
    if (o.previousStageId && o.targetStageId && o.previousStageId !== o.targetStageId) item.leadsMoved += 1;

    if (o.substage) {
      const subId = o.substage.id;
      if (!item.substageCounts.has(subId)) {
        item.substageCounts.set(subId, {
          substageId: subId,
          name: o.substage.name,
          stageName: o.substage.leadStage?.name || 'General',
          color: o.substage.leadStage?.color || '#3b82f6',
          count: 0,
        });
      }
      item.substageCounts.get(subId).count += 1;

      if (!substageGlobalMap.has(subId)) {
        substageGlobalMap.set(subId, {
          substageId: subId,
          name: o.substage.name,
          stageName: o.substage.leadStage?.name || 'General',
          color: o.substage.leadStage?.color || '#3b82f6',
          outcomeCategory: o.substage.outcomeCategory || 'NEUTRAL',
          selectedCount: 0,
          uniqueLeadsSet: new Set<string>(),
          usersSet: new Set<string>(),
          connectedCalls: 0,
          notConnectedCalls: 0,
        });
      }
      const gItem = substageGlobalMap.get(subId);
      gItem.selectedCount += 1;
      gItem.uniqueLeadsSet.add(o.leadId);
      gItem.usersSet.add(o.userId);
      if (o.connectionStatus === 'CONNECTED') gItem.connectedCalls += 1;
      if (o.connectionStatus === 'NOT_CONNECTED') gItem.notConnectedCalls += 1;
    }
  });

  const userSummaryList = Array.from(userMap.values()).map((u) => {
    const uniqueCalls = u.uniqueCallsSet.size;
    const connectionRate = u.totalAttempts > 0 ? Number(((u.connectedCalls / u.totalAttempts) * 100).toFixed(1)) : 0;
    const selectedSubstages = Array.from(u.substageCounts.values()).sort((a: any, b: any) => b.count - a.count);
    return {
      userId: u.userId,
      userName: u.userName,
      userEmail: u.userEmail,
      officeName: u.officeName,
      departmentName: u.departmentName,
      totalAttempts: u.totalAttempts,
      uniqueCalls,
      connectedCalls: u.connectedCalls,
      notConnectedCalls: u.notConnectedCalls,
      connectionRate,
      positiveOutcomes: u.positiveOutcomes,
      negativeOutcomes: u.negativeOutcomes,
      followUpsCreated: u.followUpsCreated,
      leadsMoved: u.leadsMoved,
      selectedSubstages,
    };
  });

  const substageBreakdown = Array.from(substageGlobalMap.values()).map((s: any) => ({
    substageId: s.substageId,
    name: s.name,
    stageName: s.stageName,
    color: s.color,
    outcomeCategory: s.outcomeCategory,
    selectedCount: s.selectedCount,
    uniqueLeads: s.uniqueLeadsSet.size,
    usersCount: s.usersSet.size,
    connectedCalls: s.connectedCalls,
    notConnectedCalls: s.notConnectedCalls,
  })).sort((a, b) => b.selectedCount - a.selectedCount);

  // Calculate max values for in-cell data bar scaling
  const maxValues = {
    totalAttempts: Math.max(...userSummaryList.map((u) => u.totalAttempts), 1),
    uniqueCalls: Math.max(...userSummaryList.map((u) => u.uniqueCalls), 1),
    connectedCalls: Math.max(...userSummaryList.map((u) => u.connectedCalls), 1),
    notConnectedCalls: Math.max(...userSummaryList.map((u) => u.notConnectedCalls), 1),
    followUpsCreated: Math.max(...userSummaryList.map((u) => u.followUpsCreated), 1),
    leadsMoved: Math.max(...userSummaryList.map((u) => u.leadsMoved), 1),
  };

  return {
    metrics: {
      totalCalls,
      uniqueCalls,
      connectedCalls,
      notConnectedCalls,
      connectionRate,
      positiveOutcomes,
      negativeOutcomes,
      followUpsCreated,
      leadsMoved,
    },
    userSummaryList,
    substageBreakdown,
    maxValues,
  };
};

export const getCallDetailedReport = async (
  workspaceId: string,
  requestingUserId: string,
  permissions: { viewAll: boolean; viewAssigned: boolean; viewOwn: boolean },
  filters: CallReportFilters,
) => {
  let allowedUserIds: string[] | null = null;
  if (!permissions.viewAll) {
    if (permissions.viewAssigned) {
      const subordinates = await (prisma as any).user.findMany({
        where: { supervisorId: requestingUserId, workspaceId, deletedAt: null },
        select: { id: true },
      });
      allowedUserIds = [requestingUserId, ...subordinates.map((s: any) => s.id)];
    } else {
      allowedUserIds = [requestingUserId];
    }
  }

  const outcomeWhere: any = { workspaceId };

  if (filters.userIds && filters.userIds.length > 0) {
    const requested = allowedUserIds
      ? filters.userIds.filter((id) => allowedUserIds!.includes(id))
      : filters.userIds;
    outcomeWhere.userId = { in: requested };
  } else if (allowedUserIds) {
    outcomeWhere.userId = { in: allowedUserIds };
  }

  if (filters.startDate || filters.endDate) {
    const dateFilter: any = {};
    if (filters.startDate) dateFilter.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
    if (filters.endDate) dateFilter.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
    outcomeWhere.submittedAt = dateFilter;
  }

  if (filters.connectionStatus) outcomeWhere.connectionStatus = filters.connectionStatus;
  if (filters.substageId) outcomeWhere.substageId = filters.substageId;
  if (filters.leadStageId) outcomeWhere.targetStageId = filters.leadStageId;

  if (filters.search) {
    outcomeWhere.OR = [
      { lead: { name: { contains: filters.search, mode: 'insensitive' } } },
      { lead: { phone: { contains: filters.search, mode: 'insensitive' } } },
      { user: { name: { contains: filters.search, mode: 'insensitive' } } },
      { outcomeNotes: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const page = Math.max(filters.page || 1, 1);
  const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
  const skip = (page - 1) * limit;

  const [total, rows] = await Promise.all([
    (prisma as any).leadCallOutcome.count({ where: outcomeWhere }),
    (prisma as any).leadCallOutcome.findMany({
      where: outcomeWhere,
      skip,
      take: limit,
      orderBy: { submittedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            office: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        substage: {
          select: {
            id: true,
            name: true,
            leadStage: { select: { id: true, name: true, color: true } },
          },
        },
        previousStage: { select: { id: true, name: true } },
        targetStage: { select: { id: true, name: true, color: true } },
        callSession: { select: { id: true, sourceContext: true, localCallDate: true, initiatedAt: true } },
      },
    }),
  ]);

  return {
    rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getLocalDateStr = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
