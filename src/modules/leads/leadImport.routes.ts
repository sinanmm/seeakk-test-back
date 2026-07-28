import { Router } from 'express';
import multer from 'multer';
import { protect } from '../../middlewares/authMiddleware';
import { checkUserLock } from '../../middlewares/lockMiddleware';
import { importLeads, getImportStatus, validateImport } from './leadImport.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

router.use(protect);
router.use(checkUserLock);

router.post('/import', upload.single('file'), importLeads);
router.post('/import/validate', upload.single('file'), validateImport);
router.get('/import/:jobId', getImportStatus);

export default router;
