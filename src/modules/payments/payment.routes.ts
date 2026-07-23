import { Router } from 'express';
import multer from 'multer';
import * as paymentController from './payment.controller';
import { protect } from '../../middlewares/authMiddleware';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 }, // 1 MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'image/png' || file.mimetype === 'image/webp') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, JPEG, PNG and WEBP are allowed.') as any, false);
    }
  }
});

const router = Router();
router.use(protect);

router.get('/pending', paymentController.getAllPendingAdvances);
router.post('/:leadId/advances', upload.single('proofImage'), paymentController.createAdvance);
router.put('/:leadId/advances/:advanceId/approve', paymentController.approveAdvance);
router.put('/:leadId/advances/:advanceId/reject', paymentController.rejectAdvance);
router.get('/:leadId/advances', paymentController.getAdvancesByLeadId);
router.get('/:leadId/history', paymentController.getPaymentHistory);

export default router;
