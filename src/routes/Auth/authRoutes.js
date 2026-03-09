const express = require("express");
const router = express.Router();

const authController = require("../../controllers/Auth/authController");

router.post("/register", authController.register);
router.get("/verify-email", authController.verifyEmail);

router.post("/invite", authController.inviteUser);
router.post("/activate", authController.activateAccount);

router.post("/login", authController.login);

router.post("/google", authController.googleLogin);

router.post("/refresh", authController.refreshToken);

router.post("/logout", authController.logout);

module.exports = router;