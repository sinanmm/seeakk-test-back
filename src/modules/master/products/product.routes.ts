import { Router } from 'express';
import { checkAnyPermission, checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as productController from './product.controller';

const router = Router();

router.post(
  '/',
  protect,
  checkAnyPermission(['PRODUCTS_CREATE', 'SYSTEM_CONFIG']),
  productController.createProduct,
);

router.get(
  '/',
  protect,
  checkAnyPermission(['PRODUCTS_VIEW', 'SYSTEM_CONFIG']),
  productController.listProducts,
);

router.get(
  '/active',
  protect,
  checkAnyPermission([
    'PRODUCTS_VIEW',
    'PRODUCT_PRICES_VIEW',
    'LEADS_CREATE',
    'LEADS_EDIT',
    'LEADS_VIEW_ALL',
    'LEADS_VIEW_TEAM',
    'LEADS_VIEW_OWN',
    'SYSTEM_CONFIG',
  ]),
  productController.getActiveProducts,
);

router.put(
  '/:id',
  protect,
  checkAnyPermission(['PRODUCTS_EDIT', 'SYSTEM_CONFIG']),
  productController.updateProduct,
);

router.patch(
  '/:id/status',
  protect,
  checkAnyPermission(['PRODUCTS_EDIT', 'SYSTEM_CONFIG']),
  productController.toggleProductStatus,
);

router.delete(
  '/:id',
  protect,
  checkAnyPermission(['PRODUCTS_DELETE', 'SYSTEM_CONFIG']),
  productController.deleteProduct,
);

export default router;
