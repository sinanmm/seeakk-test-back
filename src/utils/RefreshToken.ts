import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { IUser } from '../models/Auth/user';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenId: string;
}

const generateTokens = (user: IUser): Tokens => {
  const tokenId = uuidv4();

  const accessToken = jwt.sign(
    {
      userId: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      userId: user._id,
      tokenId,
    },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken, tokenId };
};

export default generateTokens;
