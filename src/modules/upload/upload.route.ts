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
      return cb(new Error(result.error || 'Invalid file type'));
    }
    cb(null, true);
  },
});

// Protect route with auth middleware and handle single file upload
router.post('/', protect, upload.single('file'), uploadFile);

// Proxy route to stream uploaded files securely using validated storage keys
router.get(/^\/(.+)$/, getFile);

export default router;
