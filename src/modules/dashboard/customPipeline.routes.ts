import { Router } from 'express';
import { protect, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as customPipelineController from './customPipeline.controller';

const router = Router();

router.use(protect);

// Sections
router.get(
  '/pipeline-sections',
  checkAnyPermission(['DASHBOARD_CUSTOM_VIEW', 'DASHBOARD_VIEW_OWN', 'DASHBOARD_VIEW_ALL', 'SYSTEM_CONFIG']),
  customPipelineController.getSections,
);

router.post(
  '/pipeline-sections',
  checkAnyPermission(['DASHBOARD_CUSTOM_MANAGE_SECTIONS', 'DASHBOARD_CUSTOM_CREATE_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.createSection,
);

router.patch(
  '/pipeline-sections/reorder',
  checkAnyPermission(['DASHBOARD_CUSTOM_MANAGE_SECTIONS', 'DASHBOARD_CUSTOM_EDIT_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.reorderSections,
);

router.patch(
  '/pipeline-sections/:id',
  checkAnyPermission(['DASHBOARD_CUSTOM_MANAGE_SECTIONS', 'DASHBOARD_CUSTOM_EDIT_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.updateSection,
);

router.delete(
  '/pipeline-sections/:id',
  checkAnyPermission(['DASHBOARD_CUSTOM_MANAGE_SECTIONS', 'DASHBOARD_CUSTOM_DELETE_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.deleteSection,
);

// Pipelines
router.post(
  '/pipelines',
  checkAnyPermission(['DASHBOARD_CUSTOM_CREATE_OWN', 'DASHBOARD_CUSTOM_CREATE_SHARED', 'SYSTEM_CONFIG']),
  customPipelineController.createPipeline,
);

router.post(
  '/pipelines/preview',
  checkAnyPermission(['DASHBOARD_CUSTOM_VIEW', 'DASHBOARD_CUSTOM_CREATE_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.previewPipeline,
);

router.post(
  '/pipelines/duplicate/:id',
  checkAnyPermission(['DASHBOARD_CUSTOM_CREATE_OWN', 'SYSTEM_CONFIG']),
  customPipelineController.duplicatePipeline,
);

router.patch(
  '/pipelines/:id',
  checkAnyPermission(['DASHBOARD_CUSTOM_EDIT_OWN', 'DASHBOARD_CUSTOM_EDIT_SHARED', 'SYSTEM_CONFIG']),
  customPipelineController.updatePipeline,
);

router.delete(
  '/pipelines/:id',
  checkAnyPermission(['DASHBOARD_CUSTOM_DELETE_OWN', 'DASHBOARD_CUSTOM_DELETE_SHARED', 'SYSTEM_CONFIG']),
  customPipelineController.deletePipeline,
);

router.get(
  '/pipelines/:id/results',
  checkAnyPermission(['DASHBOARD_CUSTOM_VIEW', 'DASHBOARD_VIEW_OWN', 'DASHBOARD_VIEW_ALL', 'SYSTEM_CONFIG']),
  customPipelineController.getPipelineResults,
);

export default router;
