import { Router } from 'express';
import { authorize, protect } from '../../middlewares/authMiddleware';
import * as officeController from '../../controllers/User/officeController';

const router = Router();

router.use(protect);

router.get('/', authorize('admin', 'super admin', 'super-admin', 'manager'), officeController.listOffices);
router.get('/:id', authorize('admin', 'super admin', 'super-admin', 'manager'), officeController.getOfficeById);

router.post('/', authorize('admin', 'super admin', 'super-admin'), officeController.createOffice);
router.put('/:id', authorize('admin', 'super admin', 'super-admin'), officeController.updateOffice);
router.delete('/:id', authorize('admin', 'super admin', 'super-admin'), officeController.deleteOffice);
router.patch('/:id/status', authorize('admin', 'super admin', 'super-admin'), officeController.toggleOfficeStatus);

export default router;
