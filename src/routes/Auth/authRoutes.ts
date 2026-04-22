import { Router } from 'express';
import * as authController from '../../controllers/Auth/authController';
import * as authInviteController from '../../controllers/Auth/authInviteController';
import { protect, authorize } from '../../middlewares/authMiddleware';
import { authLimiter } from '../../middlewares/rateLimiter';

const router = Router();

router.post('/register', authLimiter, authController.register);
router.get('/verify-email', authController.verifyEmail);
router.get('/reset-password', authController.renderResetPasswordPage);
router.post('/reset-password/confirm', authController.resetPasswordWithToken);

// Example of RBAC logic in action: Only Admin & Managers can invite new team members
router.post('/invite', protect, authorize('admin', 'manager'), authController.inviteUser);
router.post('/activate', authController.activateAccount);

// Explicitly lock down the login route to block extreme credential stuffing dictionary attacks
router.post('/login', authLimiter, authController.login);

router.post('/google', authController.googleLogin);
router.get('/invite/validate', authInviteController.validateInvite);
router.post('/invite/accept', authInviteController.acceptInvite);

router.post('/refresh', authController.refreshToken);

router.post('/logout', authController.logout);

// Example of a strictly PROTECTED route requiring any valid logged-in user
router.get('/me', protect, authController.getMe);
router.get('/users', protect, authorize('admin', 'manager'), authController.listUsers);

export default router;
