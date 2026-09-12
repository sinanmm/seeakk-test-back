import { Router } from 'express';
import multer from 'multer';
import { uploadFile, getFile } from './upload.controller';
import { protect } from '../../middlewares/authMiddleware';
import { validateUploadedFile } from '../../utils/fileValidation.util';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const result = validateUploadedFile(file);
    if (!result.valid) {
      const err: any = new Error(result.error || 'Invalid file type');
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

const handleUpload = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'File size exceeds maximum allowed limit of 10MB.' });
      }
      return res.status(400).json({ success: false, message: err.message || 'Invalid file upload.' });
    }
    next();
  });
};

// Protect route with auth middleware and handle single file upload
router.post('/', protect, handleUpload, uploadFile);

// Proxy route to stream uploaded files securely using validated storage keys
router.get(/^\/(.+)$/, getFile);

export default router;
