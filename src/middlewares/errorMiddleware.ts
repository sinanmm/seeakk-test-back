import { Request, Response, NextFunction } from 'express';
import { applyCorsHeadersIfAllowed } from '../config/cors';
import logger from '../utils/logger';

export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  let statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = err.message;

  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found (Invalid ID format).';
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((val: any) => val.message)
      .join(', ');
  }

  if (err.code === 11000) {
    statusCode = 400;
    message = `Duplicate field value entered: ${Object.keys(err.keyValue).join(', ')}`;
  }

  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request payload is too large. Please upload a smaller file.';
  }

  if (err.name === 'MulterError') {
    statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Profile image must be 20 MB or less.'
      : err.message || 'Invalid uploaded file.';
  }

  // Identify Prisma errors
  const isPrismaError = err.name && err.name.startsWith('PrismaClient');

  const userId = (req as any).user?.id || 'unauthenticated';
  const workspaceId = (req as any).user?.workspaceId || req.headers['x-workspace-id'] || 'unknown';
  const requestId = (req as any).id || req.headers['x-request-id'] || 'unknown';

  if (statusCode >= 500) {
    logger.error(`[500 Error] ${err.message}`, {
      requestId,
      userId,
      workspaceId,
      path: req.originalUrl,
      route: req.route?.path || req.path,
      method: req.method,
      ip: req.ip,
      isPrismaError,
      prismaCode: err.code,
      prismaMeta: err.meta,
      stack: err.stack,
    });
  } else {
    logger.warn(`[${statusCode} Error] ${err.message}`, {
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
  }

  applyCorsHeadersIfAllowed(req, res);

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Internal Server Error' : message,
    errorCode: err.errorCode,
    details: err.details,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};
