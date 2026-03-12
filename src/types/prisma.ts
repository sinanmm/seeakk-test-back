// Temporary local types matching the Prisma schema
// These will be REPLACED by auto-generated Prisma types once you run:
//   npx prisma generate (after setting DATABASE_URL in .env)

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

export interface User {
  id: string;
  name: string | null;
  email: string;
  password: string | null;
  googleId: string | null;
  isOnboarded: boolean;
  isActive: boolean;
  isEmailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpires: Date | null;
  invitationToken: string | null;
  invitationExpires: Date | null;
  roleId: string | null;
  workspaceId: string | null;
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
