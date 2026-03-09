const express = require("express");
const router = express.Router();

const authController = require("../../controllers/Auth/authController");
const { protect, authorize } = require("../../middlewares/authMiddleware");
const { authLimiter } = require("../../middlewares/rateLimiter");

router.post("/register", authLimiter, authController.register);
router.get("/verify-email", authController.verifyEmail);

// Example of RBAC logic in action: Only Admin & Managers can invite new team members
router.post("/invite", protect, authorize("admin", "manager"), authController.inviteUser);
router.post("/activate", authController.activateAccount);

// Explicitly lock down the login route to block extreme credential stuffing dictionary attacks
router.post("/login", authLimiter, authController.login);

router.post("/google", authController.googleLogin);

router.post("/refresh", authController.refreshToken);

router.post("/logout", authController.logout);

// Example of a strictly PROTECTED route requiring any valid logged-in user
router.get("/me", protect, authController.getMe);

module.exports = router;