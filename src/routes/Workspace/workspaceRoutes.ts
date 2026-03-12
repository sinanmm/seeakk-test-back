import { Router } from 'express';
import * as workspaceController from '../../controllers/Workspace/workspaceController';
import * as workspaceConfigController from '../../controllers/Workspace/workspaceConfigController';
import { protect } from '../../middlewares/authMiddleware';
import { globalLimiter } from '../../middlewares/rateLimiter';

const router = Router();

// Get universally standardized timezone/language/currency arrays securely
router.get(
  '/config-meta',
  protect,
  globalLimiter,
  workspaceConfigController.getWorkspaceConfigMeta
);

// User must be successfully logged in (JWT) to Configure their Workspace
// but does NOT need an authorization ("admin") level yet, because they are configuring it for the first time
router.post('/setup', protect, globalLimiter, workspaceController.setupWorkspace);

export default router;
