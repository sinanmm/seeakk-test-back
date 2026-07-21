import { Router } from 'express';
import { protect, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as controller from './locationTracking.controller';

const router = Router();

const viewPermissions = [
  'LOCATION_TRACKING_VIEW_LIVE',
  'LOCATION_TRACKING_VIEW_HISTORY',
  'LOCATION_TRACKING_REPLAY',
  'LOCATION_TRACKING_VIEW_ALL',
  'LOCATION_TRACKING_VIEW_ASSIGNED',
  'SYSTEM_CONFIG',
];

router.use(protect);

router.post('/sessions/start', checkAnyPermission(['LOCATION_TRACKING_SHARE', 'mark_attendance']), controller.startSession);
router.post('/sessions/stop', checkAnyPermission(['LOCATION_TRACKING_SHARE', 'mark_attendance']), controller.stopSession);
router.post('/points', checkAnyPermission(['LOCATION_TRACKING_SHARE', 'mark_attendance']), controller.pushLocation);
router.get('/live', checkAnyPermission(viewPermissions), controller.getLiveLocations);
router.get('/route', checkAnyPermission(viewPermissions), controller.getRoute);
router.get('/visit-history', checkAnyPermission(viewPermissions), controller.getVisitHistoryController);
router.get('/export', checkAnyPermission(['LOCATION_TRACKING_EXPORT', 'SYSTEM_CONFIG']), controller.exportRoute);

export default router;
