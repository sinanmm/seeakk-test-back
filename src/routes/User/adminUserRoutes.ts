import { Router } from 'express';
import { protect, authorize } from '../../middlewares/authMiddleware';
import { globalLimiter } from '../../middlewares/rateLimiter';
import * as adminUserController from '../../controllers/User/adminUserController';

const router = Router();

/**
 * All routes under /api/admin/users require:
 *  1. A valid JWT (protect)
 *  2. The 'admin' or 'super-admin' role (authorize)
 *
 * Workspace scoping is enforced inside the service layer using req.user.workspaceId.
 */
router.use(protect, authorize('admin', 'super-admin'), globalLimiter);

// POST   /api/admin/users           — Create a user
router.post('/', adminUserController.createUser);

// GET    /api/admin/users           — List users (paginated + filterable)
router.get('/', adminUserController.listUsers);

// GET    /api/admin/users/:id       — Get single user
router.get('/:id', adminUserController.getUserById);

// PUT    /api/admin/users/:id       — Update user
router.put('/:id', adminUserController.updateUser);

// DELETE /api/admin/users/:id       — Soft-delete user
router.delete('/:id', adminUserController.deleteUser);

// PATCH  /api/admin/users/:id/status       — Activate / Deactivate
router.patch('/:id/status', adminUserController.updateUserStatus);

// POST   /api/admin/users/:id/reset-password  — Reset password
router.post('/:id/reset-password', adminUserController.resetUserPassword);

// ─── Target Settings Routes ──────────────────────────────────────────────────
import * as targetController from '../../controllers/User/targetController';

// GET    /api/admin/users/meta/target-types — Get available types
router.get('/meta/target-types', targetController.getTargetTypes);

// POST   /api/admin/users/:id/targets       — Create/Assign target
router.post('/:id/targets', targetController.createTarget);

// GET    /api/admin/users/:id/targets       — List user targets
router.get('/:id/targets', targetController.getUserTargets);

// PUT    /api/admin/users/:userId/targets/:targetId — Update target
router.put('/:userId/targets/:targetId', targetController.updateTarget);

// POST   /api/admin/users/:id/unlock        — Unlock staff account
router.post('/:id/unlock', targetController.unlockUser);

export default router;
