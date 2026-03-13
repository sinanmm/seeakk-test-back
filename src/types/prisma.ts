// Local types mirroring the Prisma schema
// These are used for references; the full auto-generated Prisma types
// are available via `@prisma/client` after running `npx prisma generate`

export interface Role {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workspace {
  id: string;
  companyName: string;
  employeeCount: string;
  timeZone: string;
  language: string;
  currencyLocale: string;
  loadSampleData: boolean;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  name: string | null;
  email: string;
  password: string | null;
  phone?: string | null;
  googleId?: string | null;
  isOnboarded: boolean;
  isActive: boolean;
  isEmailVerified: boolean;
  isLocked?: boolean;
  verificationToken?: string | null;
  verificationTokenExpires?: Date | null;
  invitationToken?: string | null;
  invitationExpires?: Date | null;
  deletedAt?: Date | null;
  roleId?: string | null;
  departmentId?: string | null;
  supervisorId?: string | null;
  workspaceId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Device {
  id: string;
  deviceId: string;
  os: string | null;
  browser: string | null;
  deviceType: string | null;
  ipAddress: string | null;
  lastActive: Date;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}
