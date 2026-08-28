import express from 'express';
import { platformAuthMiddleware } from '../../middlewares/platformAuthMiddleware';
import * as platformController from '../../controllers/Internal/platformController';

const router = express.Router();

// Strict server-to-server authorization middleware (Part 45 & 46)
router.use(platformAuthMiddleware);

// Platform Overview (Part 48)
router.get('/dashboard', platformController.getDashboard);

// Companies Management (Part 49, 50, 51)
router.get('/companies', platformController.getCompanies);
router.get('/companies/:id', platformController.getCompanyDetails);
router.get('/companies/:id/users', platformController.getCompanyUsers);

// Company Controls: Grace, Lock, Suspend (Part 57, 58, 59)
router.post('/companies/:id/grace', platformController.grantGrace);
router.post('/companies/:id/revoke-grace', platformController.revokeGrace);
router.post('/companies/:id/lock', platformController.lockCompany);
router.post('/companies/:id/unlock', platformController.unlockCompany);
router.post('/companies/:id/suspend', platformController.suspendCompany);
router.post('/companies/:id/unsuspend', platformController.unsuspendCompany);

// Payment Requests Management (Part 52, 53, 54, 55, 56)
router.get('/payment-requests', platformController.getPaymentRequests);
router.get('/payment-requests/:id', platformController.getPaymentRequestDetails);
router.get('/payment-requests/:id/proof', platformController.getPaymentProof);
router.post('/payment-requests/:id/approve', platformController.approvePayment);
router.post('/payment-requests/:id/reject', platformController.rejectPayment);

// Revenue & Financial Metrics (Part 60, 61)
router.get('/revenue', platformController.getRevenue);

// Audit Logs (Part 63)
router.get('/audit-logs', platformController.getAuditLogs);

export default router;
