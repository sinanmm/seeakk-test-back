import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import prisma from '../../config/prisma';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type StoredUserProfileImage = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_FINAL_BYTES = 1024 * 1024;
const PROFILE_IMAGE_ROOT = path.resolve(process.cwd(), process.env.USER_PROFILE_IMAGE_DIR || 'uploads/users/profile-images');

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const isAllowedUserProfileImageMimeType = (mimeType?: string | null): boolean =>
  Boolean(mimeType && ALLOWED_MIME_TYPES.has(mimeType));

const userImageDir = (userId: string): string =>
  path.join(PROFILE_IMAGE_ROOT, userId);

const userImagePath = (userId: string, variant: 'full' | 'thumb'): string =>
  path.join(userImageDir(userId), `${variant}.webp`);

const userImageUrl = (userId: string, variant: 'full' | 'thumb', uploadedAt: Date): string =>
  `/admin/users/${userId}/profile-image/${variant}?v=${uploadedAt.getTime()}`;

const deleteUserProfileImageFiles = async (userId: string): Promise<void> => {
  await Promise.allSettled([
    fs.unlink(userImagePath(userId, 'full')),
    fs.unlink(userImagePath(userId, 'thumb')),
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

export const uploadUserProfileImage = async (
  userId: string,
  file?: Express.Multer.File,
) => {
  if (!file) {
    throw createServiceError('Profile image file is required.', 422);
  }
  if (!isAllowedUserProfileImageMimeType(file.mimetype)) {
    throw createServiceError('Only JPG, JPEG, PNG, and WEBP profile images are allowed.', 422);
  }

  const existing = await (prisma as any).user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { profileImageUrl: true },
  });
  
  if (!existing) {
     throw createServiceError('User not found.', 404);
  }

  const action = existing?.profileImageUrl ? 'USER_PROFILE_IMAGE_UPDATED' : 'USER_PROFILE_IMAGE_UPLOADED';

  const [fullBuffer, thumbBuffer] = await Promise.all([
    toOptimizedWebp(file.buffer, 800, 80),
    toOptimizedWebp(file.buffer, 150, 75),
  ]);

  const targetDir = userImageDir(userId);
  await fs.mkdir(targetDir, { recursive: true });

  await Promise.all([
    fs.writeFile(userImagePath(userId, 'full'), fullBuffer),
    fs.writeFile(userImagePath(userId, 'thumb'), thumbBuffer),
  ]);

  const now = new Date();
  const profileImageUrl = userImageUrl(userId, 'full', now);

  const updatedUser = await (prisma as any).user.update({
    where: { id: userId },
    data: { profileImageUrl },
  });

  return {
    profileImageUrl: updatedUser.profileImageUrl,
  };
};

export const getUserProfileImage = async (
  userId: string,
  variant: 'full' | 'thumb',
): Promise<StoredUserProfileImage> => {
  if (variant !== 'full' && variant !== 'thumb') {
    throw createServiceError('Invalid profile image variant requested.', 400);
  }

  const imagePath = userImagePath(userId, variant);

  try {
    const buffer = await fs.readFile(imagePath);
    return {
      buffer,
      contentType: 'image/webp',
      filename: `${userId}-${variant}.webp`,
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw createServiceError('Profile image not found.', 404);
    }
    throw error;
  }
};

export const removeUserProfileImage = async (
  userId: string,
) => {
  const existing = await (prisma as any).user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { profileImageUrl: true },
  });
  if (!existing?.profileImageUrl) {
    throw createServiceError('User does not have a profile image.', 400);
  }

  await deleteUserProfileImageFiles(userId);

  const updatedUser = await (prisma as any).user.update({
    where: { id: userId },
    data: { profileImageUrl: null },
  });

  return {
    profileImageUrl: updatedUser.profileImageUrl,
  };
};
