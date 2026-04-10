import { Router } from 'express';
import { authorize, protect } from '../../../middlewares/authMiddleware';
import * as leadDynamicsController from './leadDynamics.controller';

const adminRouter = Router();
const leadDynamicsRouter = Router();
const leadValuesRouter = Router();

adminRouter.post(
  '/',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  leadDynamicsController.createLeadDynamicField,
);

adminRouter.get(
  '/',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  leadDynamicsController.listLeadDynamicFields,
);

adminRouter.put(
  '/:id',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  leadDynamicsController.updateLeadDynamicField,
);

adminRouter.delete(
  '/:id',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  leadDynamicsController.deleteLeadDynamicField,
);

leadDynamicsRouter.get('/active', protect, leadDynamicsController.getLeadDynamicActiveFields);

leadValuesRouter.post('/:id/dynamic-values', protect, leadDynamicsController.saveLeadDynamicValues);

export { adminRouter as leadDynamicsAdminRoutes, leadDynamicsRouter, leadValuesRouter };
