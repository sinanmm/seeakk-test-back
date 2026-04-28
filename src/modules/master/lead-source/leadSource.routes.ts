import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
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
  checkAnyPermission([
    'LEAD_SOURCES_VIEW',
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
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

