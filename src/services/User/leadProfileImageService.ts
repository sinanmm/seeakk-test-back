import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import prisma from '../../config/prisma';
import { clearLeadCache, ensureLeadProfileImageColumnsReady, getLeadById } from './leadService';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type StoredLeadProfileImage = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_FINAL_BYTES = 1024 * 1024;
const PROFILE_IMAGE_ROOT = path.resolve(process.cwd(), process.env.LEAD_PROFILE_IMAGE_DIR || 'uploads/leads/profile-images');

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const isAllowedLeadProfileImageMimeType = (mimeType?: string | null): boolean =>
  Boolean(mimeType && ALLOWED_MIME_TYPES.has(mimeType));

const leadImageDir = (workspaceId: string, leadId: string): string =>
  path.join(PROFILE_IMAGE_ROOT, workspaceId, leadId);

const leadImagePath = (workspaceId: string, leadId: string, variant: 'full' | 'thumb'): string =>
  path.join(leadImageDir(workspaceId, leadId), `${variant}.webp`);

const leadImageUrl = (leadId: string, variant: 'full' | 'thumb', uploadedAt: Date): string =>
  `/leads/${leadId}/profile-image/${variant}?v=${uploadedAt.getTime()}`;

const ensureLeadVisible = async (workspaceId: string, leadId: string, actor: Actor) => {
  await getLeadById(workspaceId, leadId, actor);
};

const deleteLeadProfileImageFiles = async (workspaceId: string, leadId: string): Promise<void> => {
  await Promise.allSettled([
    fs.unlink(leadImagePath(workspaceId, leadId, 'full')),
    fs.unlink(leadImagePath(workspaceId, leadId, 'thumb')),
  ]);
};

const toOptimizedWebp = async (
  buffer: Buffer,
  size: number,
  startingQuality: number,
): Promise<Buffer> => {
  let quality = startingQuality;
  let output = await sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality, effort: 5 })
    .toBuffer();

  while (output.byteLength >= MAX_FINAL_BYTES && quality > 55) {
    quality -= 7;
    output = await sharp(buffer)
      .rotate()
      .resize(size, size, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality, effort: 5 })
      .toBuffer();
  }

  if (output.byteLength >= MAX_FINAL_BYTES) {
    throw createServiceError('Image could not be optimized below 1 MB. Please choose a clearer, smaller image.', 422);
  }

  return output;
};

export const uploadLeadProfileImage = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
  file?: Express.Multer.File,
) => {
  if (!file) {
    throw createServiceError('Profile image file is required.', 422);
  }
  if (!isAllowedLeadProfileImageMimeType(file.mimetype)) {
    throw createServiceError('Only JPG, JPEG, PNG, and WEBP profile images are allowed.', 422);
  }

  await ensureLeadProfileImageColumnsReady();
  await ensureLeadVisible(workspaceId, leadId, actor);

  const existing = await (prisma as any).lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: { profileImageUrl: true },
  });
  const action = existing?.profileImageUrl ? 'LEAD_PROFILE_IMAGE_UPDATED' : 'LEAD_PROFILE_IMAGE_UPLOADED';
  const activityText = existing?.profileImageUrl ? 'Profile image updated.' : 'Profile image uploaded.';
  const uploadedAt = new Date();
  const [full, thumb] = await Promise.all([
    toOptimizedWebp(file.buffer, 600, 86),
    toOptimizedWebp(file.buffer, 96, 78),
  ]);
  const directory = leadImageDir(workspaceId, leadId);

  await fs.mkdir(directory, { recursive: true });
  await deleteLeadProfileImageFiles(workspaceId, leadId);
  await Promise.all([
    fs.writeFile(leadImagePath(workspaceId, leadId, 'full'), full),
    fs.writeFile(leadImagePath(workspaceId, leadId, 'thumb'), thumb),
  ]);

  await prisma.$transaction(async (tx: any) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        profileImageUrl: leadImageUrl(leadId, 'full', uploadedAt),
        profileImageThumbnail: leadImageUrl(leadId, 'thumb', uploadedAt),
        profileImageUploadedAt: uploadedAt,
        profileImageUploadedById: actor.id,
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId,
        workspaceId,
        performedById: actor.id,
        action,
        metadata: {
          message: activityText,
          contentType: 'image/webp',
          fullSizeBytes: full.byteLength,
          thumbnailSizeBytes: thumb.byteLength,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        workspaceId,
        action,
        entityType: 'Lead',
        entityId: leadId,
        details: {
          message: activityText,
          contentType: 'image/webp',
          fullSizeBytes: full.byteLength,
          thumbnailSizeBytes: thumb.byteLength,
        },
      },
    });
  });

  await clearLeadCache(workspaceId);
  return getLeadById(workspaceId, leadId, actor);
};

export const removeLeadProfileImage = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
) => {
  await ensureLeadProfileImageColumnsReady();
  await ensureLeadVisible(workspaceId, leadId, actor);
  const existing = await (prisma as any).lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: { profileImageUrl: true },
  });

  if (!existing) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  await deleteLeadProfileImageFiles(workspaceId, leadId);
  await prisma.$transaction(async (tx: any) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        profileImageUrl: null,
        profileImageThumbnail: null,
        profileImageUploadedAt: null,
        profileImageUploadedById: null,
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId,
        workspaceId,
        performedById: actor.id,
        action: 'LEAD_PROFILE_IMAGE_REMOVED',
        metadata: { message: 'Profile image removed.' },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        workspaceId,
        action: 'LEAD_PROFILE_IMAGE_REMOVED',
        entityType: 'Lead',
        entityId: leadId,
        details: { message: 'Profile image removed.' },
      },
    });
  });

  await clearLeadCache(workspaceId);
  return getLeadById(workspaceId, leadId, actor);
};

export const getLeadProfileImage = async (
  workspaceId: string,
  actor: Actor,
  leadId: string,
  variant: 'full' | 'thumb',
): Promise<StoredLeadProfileImage> => {
  await ensureLeadVisible(workspaceId, leadId, actor);
  const filePath = leadImagePath(workspaceId, leadId, variant);
  try {
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      contentType: 'image/webp',
      filename: `${leadId}-${variant}.webp`,
    };
  } catch {
    throw createServiceError('Lead profile image was not found.', 404);
  }
};
