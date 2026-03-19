import { Router } from 'express';
import { protect, checkPermission } from '../../../middlewares/authMiddleware';
import * as departmentsController from './departments.controller';

const router = Router();

/**
 * All routes under /api/admin/departments require:
 * 1. A valid JWT (protect)
 * 2. Specific permissions (checkPermission)
 */

// POST /api/admin/departments - Create a new department
router.post(
  '/',
  protect,
  checkPermission('DEPARTMENTS_CREATE'),
  departmentsController.createDepartment
);

// GET /api/admin/departments - List departments (paginated + searchable)
router.get(
  '/',
  protect,
  checkPermission('DEPARTMENTS_VIEW'),
  departmentsController.listDepartments
);

// GET /api/admin/departments/active - Get all active departments (for dropdowns)
router.get(
  '/active',
  protect,
  checkPermission('DEPARTMENTS_VIEW'),
  departmentsController.getActiveDepartments
);

// PUT /api/admin/departments/:id - Update department
router.put(
  '/:id',
  protect,
  checkPermission('DEPARTMENTS_EDIT'),
  departmentsController.updateDepartment
);

// DELETE /api/admin/departments/:id - Delete department (soft delete)
router.delete(
  '/:id',
  protect,
  checkPermission('DEPARTMENTS_DELETE'),
  departmentsController.deleteDepartment
);

export default router;
