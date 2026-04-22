import { Router } from 'express';
import { protect, checkPermission } from '../../../middlewares/authMiddleware';
import * as rolesController from './roles.controller';

const router = Router();

/**
 * All routes under /api/admin/roles require:
 * 1. A valid JWT (protect)
 * 2. Specific permissions (checkPermission)
 */

// POST /api/admin/roles - Create a new role
router.post(
  '/',
  protect,
  checkPermission('ROLES_CREATE'),
  rolesController.createRole
);

// GET /api/admin/roles - List roles (paginated + searchable)
router.get(
  '/',
  protect,
  checkPermission('ROLES_VIEW'),
  rolesController.listRoles
);

// GET /api/admin/roles/:id - Get role with permissions
router.get(
  '/:id',
  protect,
  checkPermission('ROLES_VIEW'),
  rolesController.getRoleById
);

// PUT /api/admin/roles/:id - Update role and permissions
router.put(
  '/:id',
  protect,
  checkPermission('ROLES_EDIT'),
  rolesController.updateRole
);

// GET /api/admin/roles/meta/permissions - List all available permissions
router.get(
  '/meta/permissions',
  protect,
  checkPermission('ROLES_VIEW'),
  rolesController.listPermissions
);

// DELETE /api/admin/roles/:id - Delete role
router.delete(
  '/:id',
  protect,
  checkPermission('ROLES_DELETE'),
  rolesController.deleteRole
);

export default router;
