import { Router } from 'express';
import * as authController from '../../controllers/Auth/authController';
import * as authInviteController from '../../controllers/Auth/authInviteController';
import * as authPasswordResetController from '../../controllers/Auth/authPasswordResetController';
import { protect, authorize } from '../../middlewares/authMiddleware';
import { authLimiter, passwordResetLimiter } from '../../middlewares/rateLimiter';

const router = Router();

router.post('/register', authLimiter, authController.register);
router.get('/verify-email', authController.verifyEmail);
router.get('/reset-password', authController.renderResetPasswordPage);
router.post('/reset-password/confirm', authController.resetPasswordWithToken);

// Self-service forgot password (DB-backed single-use tokens; see passwordResetService)
router.post('/forgot-password', passwordResetLimiter, authPasswordResetController.forgotPassword);
router.get('/reset-password/validate', authPasswordResetController.validateResetToken);
router.post('/reset-password', passwordResetLimiter, authPasswordResetController.resetPassword);


// Explicitly lock down the login route to block extreme credential stuffing dictionary attacks
router.post('/login', authLimiter, authController.login);

router.post('/google', authController.googleLogin);
router.get('/invite/validate', authInviteController.validateInvite);
router.post('/invite/accept', authInviteController.acceptInvite);

router.post('/refresh', authController.refreshToken);

router.post('/logout', authController.logout);

// Example of a strictly PROTECTED route requiring any valid logged-in user
router.get('/me', protect, authController.getMe);
router.put('/me', protect, authController.updateMe);
router.get('/users', protect, authorize('admin', 'manager'), authController.listUsers);

export default router;
