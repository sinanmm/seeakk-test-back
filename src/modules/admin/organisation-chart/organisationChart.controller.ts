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

