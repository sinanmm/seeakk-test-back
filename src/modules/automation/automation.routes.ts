import { Router } from 'express';
import { checkAnyPermission, protect } from '../../middlewares/authMiddleware';
import * as controller from './automation.controller';

const router = Router();

// Retrieve all workflows & metadata config (Read permissions)
router.get(
  '/',
  protect,
  checkAnyPermission(['AUTOMATION_VIEW', 'SYSTEM_CONFIG']),
  controller.listWorkflows
);

router.get(
  '/meta',
  protect,
  checkAnyPermission(['AUTOMATION_VIEW', 'AUTOMATION_CREATE', 'AUTOMATION_EDIT', 'SYSTEM_CONFIG']),
  controller.getAutomationMeta
);

router.get(
  '/:id',
  protect,
  checkAnyPermission(['AUTOMATION_VIEW', 'SYSTEM_CONFIG']),
  controller.getWorkflow
);

// Create new workflows
router.post(
  '/',
  protect,
  checkAnyPermission(['AUTOMATION_CREATE', 'SYSTEM_CONFIG']),
  controller.createWorkflow
);

// Update/Edit existing workflows
router.put(
  '/:id',
  protect,
  checkAnyPermission(['AUTOMATION_EDIT', 'SYSTEM_CONFIG']),
  controller.updateWorkflow
);

// Delete workflows
router.delete(
  '/:id',
  protect,
  checkAnyPermission(['AUTOMATION_DELETE', 'SYSTEM_CONFIG']),
  controller.deleteWorkflow
);

// Toggle active/inactive status
router.patch(
  '/:id/status',
  protect,
  checkAnyPermission(['AUTOMATION_ACTIVATE', 'SYSTEM_CONFIG']),
  controller.toggleStatus
);

// Workflow Runs & executions logs
router.get(
  '/:id/runs',
  protect,
  checkAnyPermission(['AUTOMATION_VIEW_RUNS', 'SYSTEM_CONFIG']),
  controller.getWorkflowRuns
);

router.get(
  '/runs/:runId',
  protect,
  checkAnyPermission(['AUTOMATION_VIEW_RUNS', 'SYSTEM_CONFIG']),
  controller.getWorkflowRunDetail
);

export default router;
