import { Router } from 'express';
import multer from 'multer';
import { protect } from '../../middlewares/authMiddleware';
import { checkUserLock } from '../../middlewares/lockMiddleware';
import * as leadController from '../../controllers/User/leadController';
import { fieldHighlightController } from '../../modules/admin/field-highlights/fieldHighlights.controller';

const router = Router();
const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      const error = new Error('Only JPG, JPEG, PNG, and WEBP profile images are allowed.') as Error & { statusCode?: number };
      error.statusCode = 422;
      cb(error);
      return;
    }
    cb(null, true);
  },
});

router.use(protect);

// Read-only meta used by assignee pickers — must stay available during target lock.
router.get('/meta/assignees', leadController.listLeadAssignees);

router.use(checkUserLock);

router.get('/meta/stage-rules', leadController.listLeadTransitionStageRules);
router.get('/export', leadController.exportLeads);
router.get('/export-xlsx', leadController.exportLeadsXlsx);
router.get('/', leadController.listLeads);
router.post('/', leadController.createLead);
router.get('/:id/profile-image', (req, res, next) => {
  req.params.variant = 'full';
  leadController.getLeadProfileImage(req, res, next);
});
router.get('/:id/profile-image/:variant', leadController.getLeadProfileImage);
router.post('/:id/profile-image', profileImageUpload.single('image'), leadController.uploadLeadProfileImage);
router.delete('/:id/profile-image', leadController.removeLeadProfileImage);
router.get('/:id', leadController.getLeadById);
router.get('/:id/history', leadController.getLeadHistory);
router.get('/:id/remarks', leadController.getLeadRemarks);
router.get('/:id/field-edits', fieldHighlightController.getLeadEdits.bind(fieldHighlightController));
router.put('/:id', leadController.updateLead);
router.patch('/:id/star', leadController.toggleLeadStar);
router.patch('/:id/stage', leadController.changeStage);
router.patch('/:id/sla/extend', leadController.extendLeadSla);
router.patch('/:id/assign', leadController.assignLead);
router.delete('/bulk', leadController.bulkDeleteLeads);
router.delete('/:id/permanent', leadController.permanentlyDeleteLead);
router.delete('/:id', leadController.deleteLead);

export default router;
