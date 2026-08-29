import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import { requireModule } from '../../middlewares/moduleGuard';
import * as controller from './automation.controller';

const router = Router();

// Protect all automation routes with authentication and module entitlement
router.use(protect);
router.use(requireModule('AUTOMATIONS'));

// Retrieve all workflows & metadata config (Read permissions)
router.get(
  '/',
  checkAnyPermission(['AUTOMATION_VIEW', 'SYSTEM_CONFIG']),
  controller.listWorkflows
);

router.get(
  '/meta',
  checkAnyPermission(['AUTOMATION_VIEW', 'AUTOMATION_CREATE', 'AUTOMATION_EDIT', 'SYSTEM_CONFIG']),
  controller.getAutomationMeta
);

router.get(
  '/:id',
  checkAnyPermission(['AUTOMATION_VIEW', 'SYSTEM_CONFIG']),
  controller.getWorkflow
);

// Create new workflows
router.post(
  '/',
  checkAnyPermission(['AUTOMATION_CREATE', 'SYSTEM_CONFIG']),
  controller.createWorkflow
);

// Update/Edit existing workflows
router.put(
  '/:id',
  checkAnyPermission(['AUTOMATION_EDIT', 'SYSTEM_CONFIG']),
  controller.updateWorkflow
);

// Delete workflows
router.delete(
  '/:id',
  checkAnyPermission(['AUTOMATION_DELETE', 'SYSTEM_CONFIG']),
  controller.deleteWorkflow
);

// Toggle active/inactive status
router.patch(
  '/:id/status',
  checkAnyPermission(['AUTOMATION_ACTIVATE', 'SYSTEM_CONFIG']),
  controller.toggleStatus
);

// Workflow Runs & executions logs
router.get(
  '/:id/runs',
  checkAnyPermission(['AUTOMATION_VIEW_RUNS', 'SYSTEM_CONFIG']),
  controller.getWorkflowRuns
);

router.get(
  '/runs/:runId',
  checkAnyPermission(['AUTOMATION_VIEW_RUNS', 'SYSTEM_CONFIG']),
  controller.getWorkflowRunDetail
);

export default router;
