import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { User } from '../types/prisma';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenId: string;
}

const generateTokens = (user: User): Tokens => {
  const tokenId = uuidv4();

  const accessToken = jwt.sign(
    {
      userId: user.id,
      roleId: user.roleId,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      tokenId,
    },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken, tokenId };
};

export default generateTokens;
