import { NextFunction, Request, Response } from 'express';
import logger from '../../../utils/logger';
import * as locationsService from './locations.service';
import type {
  ConfigureLocationLevelsInput,
  CountryIdParamInput,
  CreateCountryInput,
  CreateLocationInput,
  ListCountriesQueryInput,
  ListLocationLevelsQueryInput,
  ListLocationsQueryInput,
  LocationIdParamInput,
  LocationTreeQueryInput,
  UpdateCountryInput,
  UpdateLocationInput,
} from './locations.validation';
import {
  configureLocationLevelsSchema,
  countryIdParamSchema,
  createCountrySchema,
  createLocationSchema,
  listCountriesQuerySchema,
  listLocationLevelsQuerySchema,
  listLocationsQuerySchema,
  locationIdParamSchema,
  locationTreeQuerySchema,
  updateCountrySchema,
  updateLocationSchema,
} from './locations.validation';

const requireWorkspace = (req: Request, res: Response): string | null => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }

  return workspaceId;
};

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

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  logger.error(`Locations error during ${action}`, { error: error?.message });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createCountry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateCountryInput>(createCountrySchema, req.body, res);
  if (!input) return;

  try {
    const data = await locationsService.createCountry(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'createCountry');
  }
};

export const listCountries = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListCountriesQueryInput>(listCountriesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await locationsService.listCountries(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listCountries');
  }
};

export const updateCountry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<CountryIdParamInput>(countryIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateCountryInput>(updateCountrySchema, req.body, res);
  if (!input) return;

  try {
    const data = await locationsService.updateCountry(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'updateCountry');
  }
};

export const deleteCountry = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<CountryIdParamInput>(countryIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const data = await locationsService.deleteCountry(workspaceId, getActor(req), params.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteCountry');
  }
};

export const configureLocationLevels = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<ConfigureLocationLevelsInput>(configureLocationLevelsSchema, req.body, res);
  if (!input) return;

  try {
    const data = await locationsService.configureLocationLevels(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'configureLocationLevels');
  }
};

export const listLocationLevels = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLocationLevelsQueryInput>(listLocationLevelsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await locationsService.listLocationLevels(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listLocationLevels');
  }
};

export const createLocation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLocationInput>(createLocationSchema, req.body, res);
  if (!input) return;

  try {
    const data = await locationsService.createLocation(workspaceId, getActor(req), input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'createLocation');
  }
};

export const updateLocation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LocationIdParamInput>(locationIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateLocationInput>(updateLocationSchema, req.body, res);
  if (!input) return;

  try {
    const data = await locationsService.updateLocation(workspaceId, getActor(req), params.id, input, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLocation');
  }
};

export const deleteLocation = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LocationIdParamInput>(locationIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const data = await locationsService.deleteLocation(workspaceId, getActor(req), params.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLocation');
  }
};

export const listLocations = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLocationsQueryInput>(listLocationsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await locationsService.listLocations(workspaceId, getActor(req), query);
    return res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res, next, 'listLocations');
  }
};

export const getLocationTree = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<LocationTreeQueryInput>(locationTreeQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await locationsService.getLocationTree(workspaceId, getActor(req), query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    handleServiceError(error, res, next, 'getLocationTree');
  }
};
