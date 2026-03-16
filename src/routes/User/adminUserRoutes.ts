import { Router } from 'express';
import { protect, authorize, checkPermission } from '../../middlewares/authMiddleware';
import { globalLimiter } from '../../middlewares/rateLimiter';
import * as adminUserController from '../../controllers/User/adminUserController';

const router = Router();

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
import * as locationController from '../../controllers/User/locationController';
import * as officeController from '../../controllers/User/officeController';

// Locations
router.get('/meta/locations/tree', locationController.getLocationTree);
router.get('/meta/locations/all', locationController.getAllLocations);
router.post('/meta/locations', locationController.createLocation);
router.get('/meta/my-locations', locationController.getMyVisibleLocations); // For testing/boundary check

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

// GET    /api/admin/users           — List users (paginated + filterable)
router.get('/', checkPermission('USERS_VIEW'), adminUserController.listUsers);

// GET    /api/admin/users/:id       — Get single user
router.get('/:id', checkPermission('USERS_VIEW'), adminUserController.getUserById);

// PUT    /api/admin/users/:id       — Update user
router.put('/:id', checkPermission('USERS_EDIT'), adminUserController.updateUser);

// DELETE /api/admin/users/:id       — Soft-delete user
router.delete('/:id', checkPermission('USERS_DELETE'), adminUserController.deleteUser);

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
