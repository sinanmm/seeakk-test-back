import { Router } from 'express';
import { protect } from '../../middlewares/authMiddleware';
import { 
  getPendingPaymentRequest,
  submitPaymentProof,
  createRenewalRequest,
  getEntitlements,
  getAvailablePlans
} from '../../controllers/Workspace/subscription.controller';

const router = Router();

// Protect these routes using the base authentication middleware.
// Note: These specific routes are accessible to authenticated workspace members
// so that a user whose workspace needs attention can view entitlements/payment options.
router.use(protect);

router.get('/request', getPendingPaymentRequest);
router.post('/submit', submitPaymentProof);
router.post('/renew', createRenewalRequest);
router.get('/entitlements', getEntitlements);
router.get('/plans', getAvailablePlans);

export default router;
