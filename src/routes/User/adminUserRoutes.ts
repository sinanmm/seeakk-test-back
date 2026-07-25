import { Router } from 'express';
import multer from 'multer';
import { protect, authorize, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import { globalLimiter } from '../../middlewares/rateLimiter';
import * as adminUserController from '../../controllers/User/adminUserController';

const router = Router();
const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit before compression
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      const error = new Error('Only JPG, JPEG, PNG, and WEBP profile images are allowed.') as Error & { statusCode?: number };
      error.statusCode = 422;
      cb(error);
      return;
    }
    cb(null, true);
  },
});

// Apply protection to all admin user routes
router.use(protect);

/**
 * All routes under /api/admin/users require:
 *  1. A valid JWT (protect)
 *  2. The 'admin' or 'super-admin' role (authorize)
 *
 * Workspace scoping is enforced inside the service layer using req.user.workspaceId.
 */
// ─── Location & Office Meta Routes (Configurable by Admin) ────────────────
import * as officeController from '../../controllers/User/officeController';

// Offices
router.get('/meta/offices', officeController.listOffices);
router.post('/meta/offices', officeController.createOffice);

// Master Data
import * as masterDataController from '../../controllers/User/masterDataController';
router.get('/meta/roles', masterDataController.getRoles);
router.get('/meta/departments', masterDataController.getDepartments);
router.get('/meta/supervisors', masterDataController.getSupervisors);

// ─── User Management Routes ───────────────────────────────────────────

// POST   /api/admin/users           — Create a user
router.post('/', checkPermission('USERS_CREATE'), adminUserController.createUser);
router.post('/invite', checkPermission('USERS_CREATE'), adminUserController.inviteUser);
router.post('/invite/:id/resend', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.resendInvite);
router.post('/invite/:id/revoke', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.revokeInvite);

// GET    /api/admin/users           — List users (paginated + filterable)
router.get('/', checkAnyPermission(['USERS_VIEW', 'ASSIGNED_USERS_VIEW']), adminUserController.listUsers);

// ─── Target Settings Routes (register before /:id to avoid param collisions) ─
import * as targetController from '../../controllers/User/targetController';

router.get('/meta/target-types', targetController.getTargetTypes);

router.put(
  '/:id/target-cycle',
  checkAnyPermission(['assign_target_cycles', 'USERS_EDIT', 'ASSIGNED_USERS_EDIT', 'SYSTEM_CONFIG']),
  targetController.assignTargetCycle,
);

router.get('/:id/targets', targetController.getUserTargets);

router.post(
  '/:id/unlock',
  checkAnyPermission(['USERS_UNLOCK', 'USERS_EDIT', 'ASSIGNED_USERS_EDIT', 'SYSTEM_CONFIG']),
  targetController.unlockUser,
);

// ─── Profile Image Routes (register before generic /:id routes) ───────────
router.get('/:id/profile-image', (req, res, next) => {
  (req.params as any).variant = 'full';
  adminUserController.getUserProfileImage(req, res, next);
});
router.get('/:id/profile-image/:variant', adminUserController.getUserProfileImage);
router.post('/:id/profile-image', profileImageUpload.single('image'), adminUserController.uploadUserProfileImage);
router.delete('/:id/profile-image', adminUserController.removeUserProfileImage);

// GET    /api/admin/users/:id       — Get single user
router.get('/:id', checkAnyPermission(['USERS_VIEW', 'ASSIGNED_USERS_VIEW']), adminUserController.getUserById);

// PUT    /api/admin/users/:id       — Update user
router.put('/:id', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.updateUser);

// DELETE /api/admin/users/:id       — Soft-delete user
router.delete('/:id', checkAnyPermission(['USERS_DELETE', 'ASSIGNED_USERS_DELETE']), adminUserController.deleteUser);

// PATCH  /api/admin/users/:id/status       — Activate / Deactivate
router.patch('/:id/status', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.updateUserStatus);

// POST   /api/admin/users/:id/reset-password  — Reset password
router.post('/:id/reset-password', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.resetUserPassword);
router.post('/:id/access-link', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.sendUserAccessLink);
router.post('/:id/send-invite', checkAnyPermission(['USERS_EDIT', 'ASSIGNED_USERS_EDIT']), adminUserController.sendInviteToUser);

export default router;
