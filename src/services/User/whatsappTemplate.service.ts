import prisma from '../../config/prisma';
import { validateTemplateVariables } from '../../utils/whatsappTemplateRenderer';

export const getWhatsAppTemplates = async (workspaceId: string, status?: string) => {
  const where: any = { workspaceId };
  if (status) {
    where.status = status;
  }
  return await prisma.whatsAppTemplate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
};

export const getWhatsAppTemplateById = async (workspaceId: string, id: string) => {
  return await prisma.whatsAppTemplate.findFirst({
    where: { id, workspaceId },
  });
};

export const createWhatsAppTemplate = async (
  workspaceId: string,
  userId: string,
  data: { name: string; category: string; message: string; status?: string }
) => {
  const { valid, invalidVars } = validateTemplateVariables(data.message);
  if (!valid) {
    const err: any = new Error(`Unsupported template variable(s): ${invalidVars.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  return await prisma.whatsAppTemplate.create({
    data: {
      workspaceId,
      createdByUserId: userId,
      name: data.name,
      category: data.category,
      message: data.message,
      status: data.status || 'ACTIVE',
    },
  });
};

export const updateWhatsAppTemplate = async (
  workspaceId: string,
  id: string,
  data: { name?: string; category?: string; message?: string; status?: string }
) => {
  const existing = await getWhatsAppTemplateById(workspaceId, id);
  if (!existing) {
    const err: any = new Error('Template not found');
    err.statusCode = 404;
    throw err;
  }

  if (data.message) {
    const { valid, invalidVars } = validateTemplateVariables(data.message);
    if (!valid) {
      const err: any = new Error(`Unsupported template variable(s): ${invalidVars.join(', ')}`);
      err.statusCode = 422;
      throw err;
    }
  }

  return await prisma.whatsAppTemplate.update({
    where: { id },
    data: {
      ...data,
    },
  });
};

export const deleteWhatsAppTemplate = async (workspaceId: string, id: string) => {
  const existing = await getWhatsAppTemplateById(workspaceId, id);
  if (!existing) {
    const err: any = new Error('Template not found');
    err.statusCode = 404;
    throw err;
  }

  const usageCount = await prisma.followUp.count({
    where: { whatsappTemplateId: id },
  });

  if (usageCount > 0) {
    // Soft-deactivate to preserve historical references
    return await prisma.whatsAppTemplate.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  return await prisma.whatsAppTemplate.delete({
    where: { id },
  });
};
