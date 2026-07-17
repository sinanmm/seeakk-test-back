import { Request, Response, NextFunction } from 'express';
import { UploadService } from './upload.service';

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
