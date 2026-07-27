import { Request, Response, NextFunction } from 'express';
import * as service from './locationTracking.service';
import { getVisitHistory } from './locationTracking.service';
import {
  liveQuerySchema,
  pushLocationSchema,
  routeQuerySchema,
  startSessionSchema,
  stopSessionSchema,
} from './locationTracking.validation';

const workspaceIdFrom = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({ success: false, message: 'Forbidden: No workspace linked to your account.' });
    return null;
  }
  return workspaceId;
};

const handleError = (error: any, res: Response, next: NextFunction) => {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  return next(error);
};

export const startSession = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.startSession(workspaceId, req.user, parsed.data);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const stopSession = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = stopSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.stopSession(workspaceId, req.user, parsed.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const pushLocation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = pushLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.pushLocation(workspaceId, req.user, parsed.data);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const getPoints = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const rawQuery = {
    userId: req.query.userId || req.user!.id,
    date: req.query.date,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };
  const parsed = routeQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.getRoute(workspaceId, req.user, parsed.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const getLiveLocations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = liveQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.getLiveLocations(workspaceId, req.user, parsed.data.userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const getRoute = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = routeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = await service.getRoute(workspaceId, req.user, parsed.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

export const exportRoute = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = workspaceIdFrom(req, res);
  if (!workspaceId) return;
  const parsed = routeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  try {
    const csv = await service.exportRouteCsv(workspaceId, req.user, parsed.data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="location-route.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return handleError(error, res, next);
  }
};
export const getVisitHistoryController = async (req: Request, res: Response) => {
  try {
    const data = await getVisitHistory(req.user!.workspaceId!, req.user!, req.query as any);
    res.json(data);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
