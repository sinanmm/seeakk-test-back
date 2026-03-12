import type { User, Role, Device } from '../prisma';

// Extend the Express Request interface to include the authenticated user
declare module 'express-serve-static-core' {
  interface Request {
    user?: User & { role: Role | null; devices?: Device[] };
  }
}

export {};
