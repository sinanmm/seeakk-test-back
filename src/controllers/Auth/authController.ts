import { Request, Response } from 'express';
import verifyGoogleToken from '../../services/Auth/googleAuthService';
import generateTokens from '../../utils/RefreshToken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { sendVerificationEmail } from '../../services/Email/emailService';
import { trackUserDevice } from '../../utils/deviceTracker';
import logger from '../../utils/logger';

export const inviteUser = async (req: Request, res: Response): Promise<any> => {
  return res.status(501).json({ message: 'inviteUser is not implemented yet' });
};

export const activateAccount = async (req: Request, res: Response): Promise<any> => {
  return res.status(501).json({ message: 'activateAccount is not implemented yet' });
};

export const register = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      logger.warn('Failed registration - email already exists', { email, action: 'register_failed' });
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        isEmailVerified: false,
        verificationToken,
        verificationTokenExpires,
      },
    });

    await sendVerificationEmail(user.email, verificationToken);

    return res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
    });
  } catch (error: any) {
    logger.error('Error during registration', { error: error.message, email: req.body.email });
    return res.status(500).json({ message: 'Registration failed' });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Verification token is missing' });
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token as string,
        verificationTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      logger.warn('Invalid or expired verification token', { token, action: 'verify_email_failed' });
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        verificationToken: null,
        verificationTokenExpires: null,
      },
    });

    logger.info('Email verified', { userId: user.id, email: user.email, action: 'verify_email_success' });

    return res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f9fafb;">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: #10b981;">Email Verified! ✅</h1>
            <p style="color: #6b7280; font-size: 1.1rem; margin-top: 10px;">Your account has been successfully activated.</p>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login"
               style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Go to Login
            </a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).json({ message: 'Email verification failed' });
  }
};

export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, devices: true },
    });

    if (!user) {
      logger.warn('Login failed - user not found', { email, action: 'login_failed' });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.password) {
      return res.status(400).json({ message: 'Password login is not enabled for this account' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Please verify your email address to log in.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn('Login failed - wrong password', { email, userId: user.id, action: 'login_failed' });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    logger.info('Login successful', { email, userId: user.id, action: 'login_success' });

    const tokens = generateTokens(user);
    await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
    await trackUserDevice(req, user);

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isOnboarded: user.isOnboarded,
        devices: user.devices,
      },
      ...tokens,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed' });
  }
};

export const googleLogin = async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    if (typeof token !== 'string' || token.split('.').length !== 3) {
      return res.status(400).json({ message: 'Send a valid Google ID token (JWT), not Google client ID' });
    }

    let payload: any;
    try {
      payload = await verifyGoogleToken(token);
    } catch (error: any) {
      logger.warn('Google login verification failed', { error: error.message, action: 'google_login_failed' });
      return res.status(401).json({ message: 'Invalid or expired Google token' });
    }

    const { email, name, sub } = payload;

    let user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, devices: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name,
          email,
          googleId: sub,
          isEmailVerified: true,
        },
        include: { role: true, devices: true },
      });
    }

    const tokens = generateTokens(user);

    if (redisClient?.isOpen) {
      await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
    } else {
      console.warn('Redis not connected. Skipping refresh token storage for Google login.');
    }

    logger.info('Google login successful', { email: user.email, userId: user.id, action: 'google_login_success' });
    await trackUserDevice(req, user);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isOnboarded: user.isOnboarded,
        devices: user.devices,
      },
      ...tokens,
    });
  } catch (error) {
    console.error('googleLogin error:', error);
    return res.status(500).json({ message: 'Google login failed' });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const { userId, tokenId } = decoded;

    const storedUserId = await redisClient.get(`refresh:${tokenId}`);
    if (!storedUserId || storedUserId !== userId) {
      logger.warn('Refresh token rejected - stolen or already used', { userId, tokenId, action: 'refresh_token_rejected' });
      return res.status(401).json({ message: 'Invalid refresh token or already consumed' });
    }

    // Rotate - invalidate old token
    await redisClient.del(`refresh:${tokenId}`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, devices: true },
    });

    if (!user || !user.isActive) {
      return res.status(403).json({ message: 'User not found or inactive' });
    }

    const tokens = generateTokens(user);
    await redisClient.set(`refresh:${tokens.tokenId}`, user.id);
    await trackUserDevice(req, user);

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isOnboarded: user.isOnboarded,
        devices: user.devices,
      },
      ...tokens,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to refresh token' });
  }
};

export const logout = async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(200).json({ message: 'Logged out successfully' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string, { ignoreExpiration: true });
    } catch {
      return res.status(200).json({ message: 'Logged out successfully' });
    }

    if (decoded?.tokenId) {
      await redisClient.del(`refresh:${decoded.tokenId}`);
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Logout failed' });
  }
};

export const getMe = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isOnboarded: user.isOnboarded,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user profile' });
  }
};
