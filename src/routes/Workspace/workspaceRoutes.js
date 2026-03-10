const express = require("express");
const router = express.Router();

const workspaceController = require("../../controllers/Workspace/workspaceController");
const { protect } = require("../../middlewares/authMiddleware");
const { globalLimiter } = require("../../middlewares/rateLimiter");

// User must be successfully logged in (JWT) to Configure their Workspace
// but does NOT need an authorization ("admin") level yet, because they are configuring it for the first time
router.post("/setup", protect, globalLimiter, workspaceController.setupWorkspace);

module.exports = router;
