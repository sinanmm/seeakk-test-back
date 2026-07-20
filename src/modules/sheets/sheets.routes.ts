import { Router } from 'express';
import multer from 'multer';
import { checkAnyPermission, checkPermission, protect } from '../../middlewares/authMiddleware';
import * as sheetsController from './sheets.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(csv|xls|xlsx)$/i.test(file.originalname);
    cb(null, allowed);
  },
});

router.use(protect);

router.get('/', checkPermission('SHEETS_VIEW'), sheetsController.listSheets);
router.post('/', checkPermission('SHEETS_CREATE'), sheetsController.createSheet);
router.post('/lead-export', checkPermission('SHEETS_IMPORT'), sheetsController.createFromLeadExport);
router.post('/import', checkPermission('SHEETS_IMPORT'), upload.single('file'), sheetsController.importFile);

router.get('/:id', checkPermission('SHEETS_VIEW'), sheetsController.getSheet);
router.get('/:id/rows', checkPermission('SHEETS_VIEW'), sheetsController.getSheetRows);
router.put('/:id', checkAnyPermission(['SHEETS_EDIT', 'SHEETS_FORMAT_MANAGE']), sheetsController.updateSheet);
router.post('/:id/duplicate', checkPermission('SHEETS_CREATE'), sheetsController.duplicateSheet);
router.delete('/:id', checkPermission('SHEETS_DELETE'), sheetsController.deleteSheet);
router.get('/:id/export', checkPermission('SHEETS_EXPORT'), sheetsController.exportSheet);
router.post('/:id/sync-leads', checkPermission('SHEETS_SYNC_LEADS'), sheetsController.syncLeadChanges);
router.get('/:id/versions', checkPermission('SHEETS_VIEW'), sheetsController.listVersions);
router.post('/:id/versions/:versionId/restore', checkPermission('SHEETS_EDIT'), sheetsController.restoreVersion);

export default router;
