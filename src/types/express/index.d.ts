import { IUser } from '../../models/Auth/user';

declare module 'express-serve-static-core' {
  interface Request {
    user?: IUser;
  }
}

export {};
