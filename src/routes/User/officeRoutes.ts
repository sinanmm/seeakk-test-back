import { Router } from 'express';
import { checkPermission, protect } from '../../middlewares/authMiddleware';
import * as officeController from '../../controllers/User/officeController';

const router = Router();

router.use(protect);

router.get('/', checkPermission('SYSTEM_CONFIG'), officeController.listOffices);
router.get('/:id', checkPermission('SYSTEM_CONFIG'), officeController.getOfficeById);

router.post('/', checkPermission('SYSTEM_CONFIG'), officeController.createOffice);
router.put('/:id', checkPermission('SYSTEM_CONFIG'), officeController.updateOffice);
router.delete('/:id', checkPermission('SYSTEM_CONFIG'), officeController.deleteOffice);
router.patch('/:id/status', checkPermission('SYSTEM_CONFIG'), officeController.toggleOfficeStatus);

export default router;
