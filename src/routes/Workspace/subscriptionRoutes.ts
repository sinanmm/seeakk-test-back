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

// Support POST /api/subscription/request for clients submitting payments or renewal requests
router.post('/request', (req, res, next) => {
  if (req.body?.utrNumber || req.body?.proofStorageKey || req.body?.paymentMethod) {
    return submitPaymentProof(req, res, next);
  }
  if (req.body?.requestedUsers || req.body?.requestedMonths || req.body?.planId || req.body?.planCode) {
    return createRenewalRequest(req, res, next);
  }
  return res.status(400).json({
    success: false,
    message: 'Invalid subscription request payload. Provide renewal parameters (requestedUsers, requestedMonths) or payment submission parameters (utrNumber, proofStorageKey).',
  });
});

router.post('/submit', submitPaymentProof);
router.post('/renew', createRenewalRequest);
router.get('/entitlements', getEntitlements);
router.get('/plans', getAvailablePlans);

export default router;
