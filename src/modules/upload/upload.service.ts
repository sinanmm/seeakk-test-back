import { storage } from '../../lib/storage/storage.factory';
import logger from '../../utils/logger';

export class UploadService {
  /**
   * Processes a file upload using the configured storage driver.
   */
  static async uploadFile(file: Express.Multer.File): Promise<{ url: string; key: string }> {
    try {
      logger.info(`Uploading file: ${file.originalname} (${file.mimetype})`);
      const result = await storage.upload(file);
      logger.info(`File uploaded successfully: ${result.key}`);
      return result;
    } catch (error) {
      logger.error('Error uploading file to storage', {
        error: error instanceof Error ? error.message : String(error),
        filename: file.originalname,
      });
      throw error;
    }
  }

  static async getFileStream(key: string): Promise<{ stream: any; contentType?: string; contentLength?: number }> {
    if (storage.getFileStream) {
      return await storage.getFileStream(key);
    }
    throw new Error('Storage driver does not support file streaming');
  }

  static async getPresignedUrl(key: string): Promise<string> {
    if (storage.getPresignedUrl) {
      return await storage.getPresignedUrl(key);
    }
    // Fallback if storage driver doesn't support presigned URLs
    return (storage as any).getPublicUrl ? (storage as any).getPublicUrl(key) : '';
  }

  /**
   * Deletes a file from the configured storage driver.
   */
  static async deleteFile(key: string): Promise<void> {
    try {
      logger.info(`Deleting file: ${key}`);
      await storage.delete(key);
      logger.info(`File deleted successfully: ${key}`);
    } catch (error) {
      logger.error('Error deleting file from storage', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      throw error;
    }
  }
}
