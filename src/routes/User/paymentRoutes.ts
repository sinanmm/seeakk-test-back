import { Router } from 'express';
import { protect, checkPermission } from '../../middlewares/authMiddleware';
import { checkUserLock } from '../../middlewares/lockMiddleware';
import * as paymentController from '../../controllers/User/payment.controller';

const router = Router();

router.use(protect);
router.use(checkUserLock);

router.get('/:id/payments', paymentController.listLeadPayments);
router.put('/:id/total-amount', checkPermission('edit_total_amount'), paymentController.updateTotalAmount);
router.post('/:id/advances', paymentController.requestAdvancePayment);

export default router;
