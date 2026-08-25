import express from 'express';
import { platformAuthMiddleware } from '../../middlewares/platformAuthMiddleware';
import * as platformController from '../../controllers/Internal/platformController';

const router = express.Router();

router.use(platformAuthMiddleware);

router.get('/dashboard', platformController.getDashboard);
router.get('/companies', platformController.getCompanies);
router.get('/payment-requests', platformController.getPaymentRequests);

router.post('/payment-requests/:id/approve', platformController.approvePayment);
router.post('/payment-requests/:id/reject', platformController.rejectPayment);

router.post('/companies/:id/grace', platformController.grantGrace);

export default router;
