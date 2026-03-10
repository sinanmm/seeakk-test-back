const express = require("express");
const router = express.Router();

const workspaceController = require("../../controllers/Workspace/workspaceController");
const workspaceConfigController = require("../../controllers/Workspace/workspaceConfigController");
const { protect } = require("../../middlewares/authMiddleware");
const { globalLimiter } = require("../../middlewares/rateLimiter");

// Get universally standardized timezone/language/currency arrays securely 
router.get("/config-meta", protect, globalLimiter, workspaceConfigController.getWorkspaceConfigMeta);

// User must be successfully logged in (JWT) to Configure their Workspace
// but does NOT need an authorization ("admin") level yet, because they are configuring it for the first time
router.post("/setup", protect, globalLimiter, workspaceController.setupWorkspace);

module.exports = router;
