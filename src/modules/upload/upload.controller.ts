import { Request, Response, NextFunction } from 'express';
import { UploadService } from './upload.service';
import { sanitizeStorageKey } from '../../utils/fileValidation.util';

export const uploadFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file provided' });
      return;
    }

    const { url, key } = await UploadService.uploadFile(req.file);

    res.status(200).json({
      success: true,
      url,
      key,
    });
  } catch (error) {
    next(error);
  }
};

export const getFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawKey = (req.params[0] || req.params.key) as string;
    if (!rawKey) {
      res.status(400).json({ success: false, message: 'No file key provided' });
      return;
    }

    let key: string;
    try {
      key = sanitizeStorageKey(decodeURIComponent(rawKey));
    } catch {
      res.status(400).json({ success: false, message: 'Invalid file key format' });
      return;
    }

    const { stream, contentType, contentLength } = await UploadService.getFileStream(key);
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Support caching for static images
    res.setHeader('Cache-Control', 'private, max-age=86400');

    (stream as any).pipe(res);
  } catch (error) {
    next(error);
  }
};
