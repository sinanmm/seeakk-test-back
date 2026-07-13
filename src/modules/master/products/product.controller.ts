import { NextFunction, Request, Response } from 'express';
import auditService from '../../../services/Audit/auditService';
import logger from '../../../utils/logger';
import { resolveWorkspaceIdForUser } from '../../../utils/workspaceContext';
import * as productService from './product.service';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type UpdateProductInput,
} from './product.validator';

function validate<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten?.().fieldErrors || result.error,
    });
    return null;
  }
  return result.data as T;
}

const getWorkspaceId = async (req: Request, res: Response): Promise<string | null> => {
  if (!req.user?.id) {
    res.status(403).json({ success: false, message: 'Authentication required.' });
    return null;
  }
  const workspaceId = await resolveWorkspaceIdForUser(req.user.id, req.user.workspaceId);
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Workspace context is required. Please complete workspace setup or refresh your session.',
    });
    return null;
  }
  return workspaceId;
};

const handleError = (error: any, res: Response, next: NextFunction, action: string) => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  if (error?.code === 'P2021' || error?.code === 'P2022') {
    res.status(503).json({
      success: false,
      message: 'Product Management module is not ready. Run Prisma migration/db push so product tables are available.',
    });
    return;
  }
  logger.error(`Product management error during ${action}`, {
    error: error?.message,
    code: error?.code,
    stack: error?.stack,
  });
  next(error);
};

export const createProduct = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<CreateProductInput>(createProductSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const data = await productService.createProduct(workspaceId, input, req.user?.id);
    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: data.id,
      details: { name: data.name, unitPrice: data.unitPrice, status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json({ success: true, message: 'Product created successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'createProduct');
  }
};

export const listProducts = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const query = validate<ListProductsQuery>(listProductsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const result = await productService.listProducts(workspaceId, query);
    res.status(200).json({ success: true, message: 'Products fetched successfully.', ...result });
  } catch (error) {
    handleError(error, res, next, 'listProducts');
  }
};

export const getActiveProducts = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const data = await productService.getActiveProducts(workspaceId);
    res.status(200).json({ success: true, message: 'Active products fetched successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'getActiveProducts');
  }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const input = validate<UpdateProductInput>(updateProductSchema, req.body, res);
  if (!input) return;

  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const id = String(req.params.id);
    const data = await productService.updateProduct(workspaceId, id, input);
    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: data.id,
      details: { updatedFields: Object.keys(input) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json({ success: true, message: 'Product updated successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'updateProduct');
  }
};

export const toggleProductStatus = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const id = String(req.params.id);
    const data = await productService.toggleProductStatus(workspaceId, id);
    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: data.status === 'ACTIVE' ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED',
      entityType: 'Product',
      entityId: data.id,
      details: { status: data.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json({ success: true, message: 'Product status updated successfully.', data });
  } catch (error) {
    handleError(error, res, next, 'toggleProductStatus');
  }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const workspaceId = await getWorkspaceId(req, res);
    if (!workspaceId) return;
    const id = String(req.params.id);
    await productService.deleteProduct(workspaceId, id);
    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'PRODUCT_DELETED',
      entityType: 'Product',
      entityId: id,
      details: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json({ success: true, message: 'Product deleted successfully.' });
  } catch (error) {
    handleError(error, res, next, 'deleteProduct');
  }
};
