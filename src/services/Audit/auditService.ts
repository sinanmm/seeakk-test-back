import prisma from '../../config/prisma';

export interface AuditLogData {
  userId?: string;
  workspaceId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}

class AuditService {
  /**
   * Create a new audit log entry
   */
  async log(data: AuditLogData) {
    try {
      return await prisma.auditLog.create({
        data: {
          userId: data.userId,
          workspaceId: data.workspaceId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          details: data.details ?? {},
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // We don't want to throw error and break the main flow if auditing fails
    }
  }

  /**
   * Get audit logs with filtering and pagination
   */
  async getLogs(filters: {
    userId?: string;
    workspaceId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
    offset?: number;
  }) {
    const { userId, workspaceId, action, entityType, entityId, limit = 50, offset = 0 } = filters;

    const where: any = {};
    if (userId) where.userId = userId;
    if (workspaceId) where.workspaceId = workspaceId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { logs, total, limit, offset };
  }
}

export default new AuditService();
