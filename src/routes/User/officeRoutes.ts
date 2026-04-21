import { Router } from 'express';
import { checkPermission, protect } from '../../middlewares/authMiddleware';
import * as officeController from '../../controllers/User/officeController';

const router = Router();

router.use(protect);

router.get('/', checkPermission('LOCATION_VIEW'), officeController.listOffices);
router.get('/:id', checkPermission('LOCATION_VIEW'), officeController.getOfficeById);

router.post('/', checkPermission('LOCATION_MANAGE'), officeController.createOffice);
router.put('/:id', checkPermission('LOCATION_MANAGE'), officeController.updateOffice);
router.delete('/:id', checkPermission('LOCATION_MANAGE'), officeController.deleteOffice);
router.patch('/:id/status', checkPermission('LOCATION_MANAGE'), officeController.toggleOfficeStatus);

export default router;
