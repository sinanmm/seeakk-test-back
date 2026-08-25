import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import { 
  getPendingPaymentRequest,
  submitPaymentProof,
  createRenewalRequest
} from '../../controllers/Workspace/subscription.controller';

const router = Router();

// Protect these routes using the base authentication middleware.
// Note: These specific routes should be EXCLUDED from the Billing Access Guard
// so that a user whose workspace is blocked can still view and submit the payment form.
router.use(protect);

router.get('/request', getPendingPaymentRequest);
router.post('/submit', submitPaymentProof);
router.post('/renew', createRenewalRequest);

export default router;
