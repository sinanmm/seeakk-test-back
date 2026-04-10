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
  private writeQueue: Promise<void> = Promise.resolve();

  private isRecoverableAuditError(error: unknown): boolean {
    const code = String((error as any)?.code || '');
    const message = String((error as any)?.message || '');

    return (
      code === 'P2024' ||
      code === 'P1001' ||
      code === 'P1017' ||
      message.includes('Timed out fetching a new connection from the connection pool') ||
      message.includes('Error in PostgreSQL connection') ||
      message.includes('Server has closed the connection') ||
      message.includes('Connection terminated unexpectedly') ||
      message.includes('connection is closed')
    );
  }

  private async writeLog(data: AuditLogData): Promise<void> {
    await prisma.auditLog.create({
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
  }

  /**
   * Create a new audit log entry
   */
  async log(data: AuditLogData) {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.writeLog(data);
        } catch (error) {
          if (!this.isRecoverableAuditError(error)) {
            console.error('Failed to create audit log:', error);
            return;
          }

          console.warn('Skipped audit log because the database pool was unavailable.', {
            action: data.action,
            entityType: data.entityType,
            entityId: data.entityId,
          });
        }
      });

    return undefined;
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
