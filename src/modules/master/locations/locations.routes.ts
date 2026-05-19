import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as locationsController from './locations.controller';

const router = Router();

router.get(
  '/countries',
  protect,
  locationsController.listCountries,
);
router.post('/countries', protect, checkPermission('LOCATION_MANAGE'), locationsController.createCountry);
router.put('/countries/:id', protect, checkPermission('LOCATION_MANAGE'), locationsController.updateCountry);
router.delete('/countries/:id', protect, checkPermission('LOCATION_MANAGE'), locationsController.deleteCountry);

router.get('/levels', protect, locationsController.listLocationLevels);
router.post('/levels', protect, checkPermission('LOCATION_MANAGE'), locationsController.configureLocationLevels);

router.get('/tree', protect, locationsController.getLocationTree);
router.get('/', protect, locationsController.listLocations);
router.post('/', protect, checkPermission('LOCATION_MANAGE'), locationsController.createLocation);
router.put('/:id', protect, checkPermission('LOCATION_MANAGE'), locationsController.updateLocation);
router.delete('/:id', protect, checkPermission('LOCATION_MANAGE'), locationsController.deleteLocation);

export default router;
