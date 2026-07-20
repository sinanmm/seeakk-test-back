import { Router } from 'express';
import multer from 'multer';
import { uploadFile, getFile } from './upload.controller';
import { protect } from '../../middlewares/authMiddleware';

const router = Router();

// Configure multer to use memory storage exclusively
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Basic file validation - you can expand this based on requirements
    if (!file.mimetype.match(/^(image\/.*|application\/pdf|application\/msword|application\/vnd.openxmlformats-officedocument.wordprocessingml.document)$/)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  },
});

// Protect route with auth middleware and handle single file upload
router.post('/', protect, upload.single('file'), uploadFile);

// Public proxy route to fetch files using presigned URLs
router.get(/^\/(.+)$/, getFile);

export default router;
