import { Router } from 'express';
import { protect, checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as whatsappTemplateController from '../../controllers/User/whatsappTemplateController';

const router = Router();

router.get('/', protect, whatsappTemplateController.getTemplates);
router.get('/:id', protect, whatsappTemplateController.getTemplateById);
router.post(
  '/',
  protect,
  checkAnyPermission(['WHATSAPP_TEMPLATES_CREATE', 'SYSTEM_CONFIG', 'manage_followup_settings', 'LEADS_VIEW_ALL', 'LEADS_VIEW_OWN', 'LEADS_VIEW_TEAM']),
  whatsappTemplateController.createTemplate
);
router.put(
  '/:id',
  protect,
  checkAnyPermission(['WHATSAPP_TEMPLATES_EDIT', 'SYSTEM_CONFIG', 'manage_followup_settings', 'LEADS_VIEW_ALL', 'LEADS_VIEW_OWN', 'LEADS_VIEW_TEAM']),
  whatsappTemplateController.updateTemplate
);
router.delete(
  '/:id',
  protect,
  checkAnyPermission(['WHATSAPP_TEMPLATES_DELETE', 'SYSTEM_CONFIG', 'manage_followup_settings', 'LEADS_VIEW_ALL', 'LEADS_VIEW_OWN', 'LEADS_VIEW_TEAM']),
  whatsappTemplateController.deleteTemplate
);
router.post('/record-opened', protect, whatsappTemplateController.recordWhatsAppOpened);

export default router;
