import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { User } from '../types/prisma';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenId: string;
}

const requireTokenSecret = (name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    const error: any = new Error(`${name} is not configured on the backend`);
    error.statusCode = 503;
    error.code = 'AUTH_SECRET_MISSING';
    error.secretName = name;
    throw error;
  }

  return value;
};

const generateTokens = (user: User): Tokens => {
  const tokenId = uuidv4();
  const jwtSecret = requireTokenSecret('JWT_SECRET');
  const jwtRefreshSecret = requireTokenSecret('JWT_REFRESH_SECRET');

  const accessToken = jwt.sign(
    {
      userId: user.id,
      roleId: user.roleId,
    },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      tokenId,
    },
    jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken, tokenId };
};

export default generateTokens;
