import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as leadSourceController from './leadSource.controller';

const router = Router();

router.post(
  '/',
  protect,
  checkPermission('LEAD_SOURCES_CREATE'),
  leadSourceController.createLeadSource,
);

router.get(
  '/',
  protect,
  checkPermission('LEAD_SOURCES_VIEW'),
  leadSourceController.listLeadSources,
);

router.get(
  '/active',
  protect,
  checkPermission('LEAD_SOURCES_VIEW'),
  leadSourceController.getActiveLeadSources,
);

router.put(
  '/:id',
  protect,
  checkPermission('LEAD_SOURCES_EDIT'),
  leadSourceController.updateLeadSource,
);

router.patch(
  '/:id/status',
  protect,
  checkPermission('LEAD_SOURCES_EDIT'),
  leadSourceController.toggleLeadSourceStatus,
);

router.delete(
  '/:id',
  protect,
  checkPermission('LEAD_SOURCES_DELETE'),
  leadSourceController.deleteLeadSource,
);

export default router;

