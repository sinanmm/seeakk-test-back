import { NextFunction, Request, Response } from 'express';
import logger from '../../../utils/logger';
import * as organisationChartService from './organisationChart.service';
import {
  OrganisationChartQuery,
  organisationChartQuerySchema,
} from './organisationChart.validator';

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
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }
  return result.data as T;
}

const handleServiceError = (
  error: any,
  res: Response,
  next: NextFunction,
  action: string,
): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  logger.error(`Organisation chart error during ${action}`, { error: error?.message });
  next(error);
};

export const getOrganisationChart = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
  }

  const query = validate<OrganisationChartQuery>(organisationChartQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await organisationChartService.getOrganisationChart(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Organisation chart fetched successfully.',
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getOrganisationChart');
  }
};

export const getSupervisorHierarchy = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
  }

  const query = validate<OrganisationChartQuery>(organisationChartQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await organisationChartService.getSupervisorHierarchy(workspaceId, query);
    return res.status(200).json({
      success: true,
      message: 'Supervisor hierarchy fetched successfully.',
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getSupervisorHierarchy');
  }
};

export const getUserDetails = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  logger.info('[Organisation Chart] Details API Request Received');
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    logger.warn('[Organisation Chart] Forbidden: No workspace linked');
    return res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
  }

  const userId = req.params.userId as string;
  logger.info(`[Organisation Chart] User ID: ${userId}`);

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  logger.info('[Organisation Chart] Controller Started');
  try {
    const data = await organisationChartService.getUserDetails(workspaceId, userId);
    logger.info(`[Organisation Chart] Response Returned for userId: ${userId}`);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    logger.error(`[Organisation Chart] Error fetching details for userId: ${userId}`, {
      message: error?.message,
      stack: error?.stack,
    });
    handleServiceError(error, res, next, 'getUserDetails');
  }
};

