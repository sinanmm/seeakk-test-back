import { Router } from 'express';
import { fieldHighlightController } from './fieldHighlights.controller';
import { protect, authorize } from '../../../middlewares/authMiddleware';

const router = Router();

// Configure the highlight fields (admin only)
router.get(
  '/',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  fieldHighlightController.getConfigs.bind(fieldHighlightController)
);

router.put(
  '/',
  protect,
  authorize('admin', 'super admin', 'super-admin'),
  fieldHighlightController.updateConfigs.bind(fieldHighlightController)
);

export const fieldHighlightRoutes = router;
